#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, createWriteStream, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

/**
 * Mac libzstd compatibility fix utilities
 * Automatically detects and resolves missing libzstd.1.dylib issues on macOS
 */

/**
 * Detect if the embedded postgres binary will fail due to missing libzstd
 */
export async function detectLibzstdIssue() {
  if (process.platform !== 'darwin') return false;
  
  try {
    // Try to find the embedded postgres binary
    const postgresPath = join(projectRoot, 'node_modules/.pnpm/@embedded-postgres+darwin-arm64@17.5.0-beta.15/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres');
    
    if (!existsSync(postgresPath)) {
      console.log('🔍 Standard postgres path not found, searching dynamically...');
      // Try to find it dynamically
      const searchPaths = [
        'node_modules/.pnpm/@embedded-postgres+darwin-arm64@*/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres',
        'node_modules/.pnpm/@embedded-postgres+darwin-x64@*/node_modules/@embedded-postgres/darwin-x64/native/bin/postgres'
      ];
      
      for (const searchPath of searchPaths) {
        try {
          const result = execSync(`find ${projectRoot} -path "*${searchPath.replace('*', '*')}" 2>/dev/null | head -1`, { encoding: 'utf8' });
          if (result.trim()) {
            console.log(`🔍 Found postgres binary at: ${result.trim()}`);
            return await testPostgresBinary(result.trim());
          }
        } catch (e) {
          // Continue searching
        }
      }
      console.log('⚠️ No postgres binary found, assuming no libzstd issue');
      return false;
    }
    
    console.log(`🔍 Testing postgres binary at: ${postgresPath}`);
    return await testPostgresBinary(postgresPath);
  } catch (error) {
    console.log('⚠️ Error during libzstd detection:', error.message);
    return false;
  }
}

/**
 * Test if a postgres binary fails due to libzstd issues
 */
async function testPostgresBinary(binaryPath) {
  try {
    execSync(`"${binaryPath}" --version 2>/dev/null`, { timeout: 5000 });
    console.log('✅ Postgres binary test passed - no libzstd issues detected');
    return false; // Binary works fine
  } catch (error) {
    console.log('⚠️ Postgres binary test failed, analyzing error...');
    
    // Check for libzstd in error message
    const errorOutput = error.stderr?.toString() || error.message || '';
    if (errorOutput.includes('libzstd.1.dylib')) {
      console.log('🔍 Detected libzstd.1.dylib error in output');
      return true;
    }
    
    // Check for "Abort trap: 6" which indicates dyld library loading failure
    if (errorOutput.includes('Abort trap: 6') || error.signal === 'SIGABRT') {
      console.log('🔍 Detected SIGABRT/Abort trap - likely libzstd issue');
      return true;
    }
    
    // Try again with stderr captured to see the actual dyld error
    try {
      execSync(`"${binaryPath}" --version`, { timeout: 5000, stdio: 'pipe' });
      console.log('✅ Postgres binary works on second try');
      return false;
    } catch (detailedError) {
      const detailedOutput = detailedError.stderr?.toString() || detailedError.message || '';
      console.log('🔍 Detailed error output:', detailedOutput.substring(0, 200) + '...');
      
      const hasLibzstdIssue = detailedOutput.includes('libzstd.1.dylib') || 
                             detailedError.signal === 'SIGABRT' ||
                             detailedOutput.includes('Library not loaded');
      
      if (hasLibzstdIssue) {
        console.log('✅ Confirmed: libzstd issue detected');
      } else {
        console.log('❌ Different issue detected, not libzstd related');
      }
      
      return hasLibzstdIssue;
    }
  }
}

/**
 * Download file from URL to destination
 */
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
      
      file.on('error', (err) => {
        file.close();
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Download libzstd directly from Homebrew bottles (no Homebrew installation required)
 */
async function downloadLibzstdFromBottle(arch, libDirs) {
  console.log('📥 Downloading libzstd directly from Homebrew bottles...');
  
  try {
    // Use the Homebrew API to get the latest bottle URLs
    const formulaUrl = 'https://formulae.brew.sh/api/formula/zstd.json';
    
    console.log('🔍 Fetching Homebrew zstd formula info...');
    
    // Download formula info
    const tempDir = join(projectRoot, '.temp-libzstd');
    await mkdir(tempDir, { recursive: true });
    
    const formulaPath = join(tempDir, 'zstd-formula.json');
    
    try {
      await downloadFile(formulaUrl, formulaPath);
      
      const formulaData = JSON.parse(readFileSync(formulaPath, 'utf8'));
      const bottles = formulaData.bottle?.stable?.files;
      
      if (!bottles) {
        throw new Error('No bottle information available');
      }
      
      // Get the right bottle for the architecture
      const macOSVersion = 'sonoma'; // Try latest first
      const bottleKey = arch === 'arm64' ? `arm64_${macOSVersion}` : `${macOSVersion}`;
      
      let bottleInfo = bottles[bottleKey] || bottles[`arm64_ventura`] || bottles[`ventura`] || bottles[`monterey`];
      
      if (!bottleInfo) {
        throw new Error(`No suitable bottle found for architecture ${arch}`);
      }
      
      console.log(`📦 Found bottle: ${bottleInfo.url}`);
      
      // Download the bottle
      const bottlePath = join(tempDir, 'zstd-bottle.tar.gz');
      console.log('📥 Downloading bottle...');
      await downloadFile(bottleInfo.url, bottlePath);
      
      // Extract the bottle to get libzstd.1.dylib
      console.log('📂 Extracting bottle...');
      
      // Use tar command to extract (simpler than tar-stream for this case)
      const extractDir = join(tempDir, 'extracted');
      await mkdir(extractDir, { recursive: true });
      
      execSync(`tar -xzf "${bottlePath}" -C "${extractDir}"`, { stdio: 'pipe' });
      
      // Find the libzstd.1.dylib file in the extracted content
      const libzstdPath = execSync(`find "${extractDir}" -name "libzstd.1.dylib" | head -1`, { encoding: 'utf8' }).trim();
      
      if (!libzstdPath || !existsSync(libzstdPath)) {
        throw new Error('libzstd.1.dylib not found in downloaded bottle');
      }
      
      console.log(`✅ Found libzstd.1.dylib at: ${libzstdPath}`);
      
      // Copy to all lib directories
      let copySuccess = false;
      for (const libDir of libDirs) {
        const targetPath = join(libDir, 'libzstd.1.dylib');
        try {
          execSync(`cp "${libzstdPath}" "${targetPath}"`);
          console.log(`✅ Copied libzstd to: ${targetPath}`);
          copySuccess = true;
        } catch (error) {
          console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
        }
      }
      
      // Cleanup
      try {
        execSync(`rm -rf "${tempDir}"`);
      } catch (e) {
        // Cleanup failed, but that's ok
      }
      
      return copySuccess;
      
    } catch (downloadError) {
      console.log('⚠️ Homebrew API download failed:', downloadError.message);
      
      // Fallback: try direct URLs for known versions
      console.log('🔄 Trying fallback download URLs...');
      
      const fallbackUrls = {
        arm64: [
          'https://ghcr.io/v2/homebrew/core/zstd/blobs/sha256:5d8ee3d8e9e8f88c8a1b8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8',
          'https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-1.5.7.tar.gz'
        ],
        x86_64: [
          'https://ghcr.io/v2/homebrew/core/zstd/blobs/sha256:8b5d6a8c9e4d7f6a5b3c2e1f9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c',
          'https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-1.5.7.tar.gz'
        ]
      };
      
      // For now, return false to trigger the next fallback strategy
      console.log('⚠️ Fallback downloads not implemented yet - using next strategy...');
      return false;
    }
    
  } catch (error) {
    console.log('❌ Failed to download libzstd from bottle:', error.message);
    return false;
  } finally {
    // Cleanup temp directory
    try {
      const tempDir = join(projectRoot, '.temp-libzstd');
      if (existsSync(tempDir)) {
        execSync(`rm -rf "${tempDir}"`);
      }
    } catch (e) {
      // Cleanup failed, but that's ok
    }
  }
}

/**
 * Automatically download and install libzstd for embedded postgres
 */
export async function downloadLibzstd() {
  console.log('🔧 Detecting Mac architecture and setting up libzstd...');
  
  // Detect architecture
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const isAppleSilicon = arch === 'arm64';
  
  console.log(`📱 Detected ${isAppleSilicon ? 'Apple Silicon (ARM64)' : 'Intel (x86_64)'} Mac`);
  
  // Create lib directory structure
  const libDirs = [];
  
  // Find all embedded postgres installations and create lib dirs for each
  try {
    const searchResult = execSync(`find ${projectRoot} -path "*/node_modules/@embedded-postgres/darwin-*/native/bin" -type d 2>/dev/null`, { encoding: 'utf8' });
    const binDirs = searchResult.trim().split('\n').filter(Boolean);
    
    for (const binDir of binDirs) {
      const libDir = join(dirname(binDir), 'lib');
      libDirs.push(libDir);
      
      if (!existsSync(libDir)) {
        await mkdir(libDir, { recursive: true });
        console.log(`📁 Created lib directory: ${libDir}`);
      }
    }
  } catch (error) {
    console.log('⚠️ Could not auto-detect embedded postgres paths, using fallback...');
    // Fallback: create standard paths
    const standardPaths = [
      join(projectRoot, 'node_modules/.pnpm/@embedded-postgres+darwin-arm64@17.5.0-beta.15/node_modules/@embedded-postgres/darwin-arm64/native/lib'),
      join(projectRoot, 'node_modules/.pnpm/@embedded-postgres+darwin-x64@17.5.0-beta.15/node_modules/@embedded-postgres/darwin-x64/native/lib')
    ];
    
    for (const libPath of standardPaths) {
      try {
        await mkdir(libPath, { recursive: true });
        libDirs.push(libPath);
      } catch (e) {
        // Directory may not exist, that's ok
      }
    }
  }
  
  if (libDirs.length === 0) {
    throw new Error('Could not find or create lib directories for embedded postgres');
  }
  
  const libzstdFilename = 'libzstd.1.dylib';
  
  // Strategy 1: Try to find libzstd locally first (if user has Homebrew already installed)
  console.log('🔍 Step 1: Checking for existing libzstd installation...');
  const localPaths = [
    '/opt/homebrew/lib/libzstd.1.dylib',     // Apple Silicon Homebrew
    '/usr/local/lib/libzstd.1.dylib',        // Intel Homebrew
    '/opt/homebrew/Cellar/zstd/*/lib/libzstd.1.dylib', // Versioned path
    '/usr/local/Cellar/zstd/*/lib/libzstd.1.dylib'     // Versioned path
  ];
  
  let sourcePath = null;
  for (const path of localPaths) {
    if (path.includes('*')) {
      // Handle glob patterns
      try {
        const result = execSync(`ls ${path} 2>/dev/null | head -1`, { encoding: 'utf8' });
        if (result.trim()) {
          sourcePath = result.trim();
          break;
        }
      } catch (e) {
        continue;
      }
    } else if (existsSync(path)) {
      sourcePath = path;
      break;
    }
  }
  
  if (sourcePath) {
    console.log(`📦 Found local libzstd at: ${sourcePath}`);
    
    // Copy to all lib directories
    for (const libDir of libDirs) {
      const targetPath = join(libDir, libzstdFilename);
      try {
        // Use cp command to preserve permissions and links
        execSync(`cp "${sourcePath}" "${targetPath}"`);
        console.log(`✅ Copied libzstd to: ${targetPath}`);
      } catch (error) {
        console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
      }
    }
    
    return true;
  }
  
  // Strategy 2: Try automated Homebrew install (if available)
  console.log('🔍 Step 2: Attempting automated Homebrew installation...');
  try {
    // Check if Homebrew is installed
    execSync('which brew', { stdio: 'pipe' });
    
    // Try to install zstd
    console.log('🍺 Installing zstd via existing Homebrew...');
    execSync('brew install zstd', { stdio: 'pipe' });
    
    // Try to find it again
    for (const path of localPaths) {
      if (path.includes('*')) {
        try {
          const result = execSync(`ls ${path} 2>/dev/null | head -1`, { encoding: 'utf8' });
          if (result.trim()) {
            sourcePath = result.trim();
            break;
          }
        } catch (e) {
          continue;
        }
      } else if (existsSync(path)) {
        sourcePath = path;
        break;
      }
    }
    
    if (sourcePath) {
      for (const libDir of libDirs) {
        const targetPath = join(libDir, libzstdFilename);
        try {
          execSync(`cp "${sourcePath}" "${targetPath}"`);
          console.log(`✅ Copied libzstd to: ${targetPath}`);
        } catch (error) {
          console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
        }
      }
      return true;
    }
  } catch (error) {
    console.log('⚠️ Homebrew not available or installation failed');
  }
  
  // Strategy 3: Download from bottle (without requiring Homebrew installation)
  console.log('🔍 Step 3: Attempting direct download...');
  const downloadSuccess = await downloadLibzstdFromBottle(arch, libDirs);
  if (downloadSuccess) {
    return true;
  }
  
  // Strategy 4: Try Rosetta fallback (Apple Silicon only)
  if (isAppleSilicon) {
    console.log('🔍 Step 4: Checking Rosetta availability...');
    try {
      // Check if Rosetta is installed
      execSync('arch -x86_64 uname -m', { stdio: 'pipe' });
      console.log('✅ Rosetta is available - Intel binary can be used as fallback');
      
      // We don't actually switch to Intel binary here, just confirm it's possible
      // The actual switching would happen in the embedded-postgres setup
      console.log('💡 You can use Intel binary with Rosetta as a fallback');
      console.log('   This will be slower but should work around the libzstd issue');
      
      return 'rosetta-fallback';
    } catch (error) {
      console.log('⚠️ Rosetta not available. Install with: softwareupdate --install-rosetta');
    }
  }
  
  // Strategy 5: User guidance for manual installation
  console.log('');
  console.log('🔧 Automatic setup failed - choose one of these options:');
  console.log('');
  console.log('Option A - Install missing dependency (quick):');
  console.log('1. Install Homebrew:');
  console.log('   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
  console.log('2. Install zstd: brew install zstd');
  console.log('3. Retry: pnpm post-setup');
  console.log('');
  
  if (isAppleSilicon) {
    console.log('Option B - Install Rosetta (Apple Silicon):');
    console.log('1. Install Rosetta: softwareupdate --install-rosetta');
    console.log('2. Retry: pnpm post-setup');
    console.log('   (Will use Intel binary with emulation)');
    console.log('');
  }
  
  console.log('Option C - Use cloud database instead (recommended):');
  console.log('   npx create-volo-app@dev your-app --database');
  console.log('   (Choose Neon or Supabase for hassle-free setup)');
  
  return false;
}

/**
 * Enhanced Mac-specific error handling for embedded postgres issues
 */
export function provideMacTroubleshootingGuidance(error, dataDir) {
  console.log('');
  console.log('🍎 Mac Troubleshooting:');
  
  // Check for specific libzstd error
  if (error.message?.includes('libzstd.1.dylib')) {
    console.log('  ❌ libzstd library missing (this should have been auto-fixed)');
    console.log('  🔧 Manual fix:');
    console.log('     1. Install Homebrew if needed');
    console.log('     2. brew install zstd');
    console.log('     3. Retry: pnpm post-setup');
  } else if (error.message?.includes('init script exited with code null') || error.message?.includes('initdb')) {
    console.log('  ❌ PostgreSQL initialization failed on Apple Silicon Mac');
    console.log('  🔧 Try these solutions in order:');
    console.log('');
    console.log('  1. Install Rosetta 2 (required for Intel emulation):');
    console.log('     softwareupdate --install-rosetta');
    console.log('');
    console.log('  2. Install Xcode Command Line Tools:');
    console.log('     xcode-select --install');
    console.log('');
    console.log('  3. Clean up and retry:');
    console.log(`     rm -rf ${join(dataDir, 'postgres')}`);
    console.log('     Then run the setup again');
    console.log('');
    console.log('  4. Alternative: Use Docker PostgreSQL instead:');
    console.log('     docker run -d --name volo-postgres -p 5433:5432 \\');
    console.log('       -e POSTGRES_PASSWORD=password postgres:15');
  } else {
    console.log('  1. If you have Apple Silicon (M1/M2/M3), try installing Rosetta 2:');
    console.log('     softwareupdate --install-rosetta');
    console.log('  2. Ensure you have required system tools:');
    console.log('     xcode-select --install');
    console.log('  3. Check available disk space and permissions in:');
    console.log(`     ${dataDir}`);
    console.log('  4. Try restarting the terminal and running again');
  }
} 