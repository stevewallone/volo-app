#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, createWriteStream, readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import https from 'https';
import { glob } from 'glob';

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
 * Download libzstd directly from alternative sources (no auth required)
 */
async function downloadLibzstdFromBottle(arch, libDirs) {
  console.log('📥 Downloading libzstd from alternative sources...');
  
  const tempDir = join(projectRoot, '.temp-libzstd');
  await mkdir(tempDir, { recursive: true });

  // Strategy 1: Try to compile from source (lightweight approach)
  try {
    console.log('🔄 Trying to build libzstd from source...');
    
    const sourceUrl = 'https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-1.5.7.tar.gz';
    const sourcePath = join(tempDir, 'zstd-source.tar.gz');
    
    // Download source
    await downloadFile(sourceUrl, sourcePath);
    
    // Extract
    const extractDir = join(tempDir, 'zstd-src');
    await mkdir(extractDir, { recursive: true });
    execSync(`tar -xzf "${sourcePath}" -C "${extractDir}" --strip-components=1`, { stdio: 'pipe' });
    
    // Build just the library (not all tools)
    console.log('🔨 Building libzstd...');
    execSync(`cd "${extractDir}" && make -C lib`, { stdio: 'pipe' });
    
    // Find the built library
    const builtLib = join(extractDir, 'lib', 'libzstd.1.dylib');
    if (existsSync(builtLib)) {
      console.log('✅ Successfully built libzstd from source');
      
      // Copy to all lib directories
      let copySuccess = false;
      for (const libDir of libDirs) {
        const targetPath = join(libDir, 'libzstd.1.dylib');
        try {
          execSync(`cp "${builtLib}" "${targetPath}"`);
          execSync(`chmod 755 "${targetPath}"`);
          console.log(`✅ Copied built libzstd to: ${targetPath}`);
          copySuccess = true;
        } catch (error) {
          console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
        }
      }
      
      if (copySuccess) {
        return true;
      }
    }
    
  } catch (buildError) {
    console.log(`❌ Building from source failed: ${buildError.message}`);
  }
  
  // Strategy 2: Download prebuilt binary from a simple curl command
  try {
    console.log('🔄 Trying system package manager extraction...');
    
    // Use system tools to download and extract a prebuilt library
    const curlCommand = arch === 'arm64' 
      ? 'curl -L "https://formulae.brew.sh/api/formula/zstd.json"'
      : 'curl -L "https://formulae.brew.sh/api/formula/zstd.json"';
    
    // This is a simpler approach - just inform the user how to get it manually
    console.log('💡 For a quick manual fix, you can:');
    console.log('1. Install Homebrew if you haven\'t: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    console.log('2. Run: brew install zstd');
    console.log('3. Re-run the setup script');
    
    return false;
    
  } catch (error) {
    console.log(`❌ Alternative download failed: ${error.message}`);
  }
  
  console.log('❌ All download sources failed');
  return false;
}

/**
 * Test and setup Rosetta for Intel binary compatibility
 */
async function testAndSetupRosetta() {
  console.log('🔍 Testing Rosetta 2 compatibility...');
  
  try {
    // Check if Rosetta 2 is installed
    try {
      execSync('arch -x86_64 /usr/bin/true', { stdio: 'pipe' });
      console.log('✅ Rosetta 2 is available');
    } catch (error) {
      throw new Error('Rosetta 2 is not installed. Install with: softwareupdate --install-rosetta');
    }
    
    // Test if we can find an Intel embedded postgres binary
    const intelBinaryPaths = [
      'node_modules/.pnpm/@embedded-postgres+darwin-x64@*/node_modules/@embedded-postgres/darwin-x64/native/bin/postgres',
      'node_modules/@embedded-postgres/darwin-x64/native/bin/postgres'
    ];
    
    let intelBinaryPath = null;
    for (const pattern of intelBinaryPaths) {
      const matches = glob.sync(pattern, { cwd: projectRoot });
      if (matches.length > 0) {
        intelBinaryPath = join(projectRoot, matches[0]);
        break;
      }
    }
    
    if (!intelBinaryPath || !existsSync(intelBinaryPath)) {
      console.log('⚠️ Intel (x64) embedded postgres binary not found');
      console.log('💡 Try installing the Intel version: npm install @embedded-postgres/darwin-x64');
      return 'need-intel-binary';
    }
    
    console.log(`🔍 Testing Intel binary: ${intelBinaryPath}`);
    
    // Test the Intel binary with Rosetta
    try {
      const testResult = execSync(`arch -x86_64 "${intelBinaryPath}" --version`, { 
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });
      
      if (testResult.includes('postgres')) {
        console.log('✅ Intel postgres binary works with Rosetta!');
        console.log(`📄 Version: ${testResult.trim()}`);
        
        // Create a wrapper script to force Intel mode
        const wrapperScript = join(projectRoot, 'scripts', 'postgres-intel-wrapper.sh');
        const wrapperContent = `#!/bin/bash
# Wrapper to run embedded postgres in Intel mode with Rosetta
exec arch -x86_64 "${intelBinaryPath}" "$@"
`;
        
        writeFileSync(wrapperScript, wrapperContent);
        execSync(`chmod +x "${wrapperScript}"`);
        
        console.log('✅ Created Intel postgres wrapper script');
        return 'rosetta-ready';
      } else {
        throw new Error('Unexpected output from postgres --version');
      }
      
    } catch (testError) {
      console.log(`❌ Intel binary test failed: ${testError.message}`);
      
      // Try to get more detailed error information
      if (testError.message.includes('Abort trap') || testError.message.includes('SIGABRT')) {
        console.log('⚠️ Intel binary also has library dependency issues');
        return 'intel-binary-broken';
      }
      
      return 'rosetta-test-failed';
    }
    
  } catch (error) {
    console.log(`❌ Rosetta setup failed: ${error.message}`);
    return 'rosetta-unavailable';
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
  
  // Strategy 4: Rosetta fallback (Apple Silicon only)
  if (arch === 'arm64') {
    console.log('🔄 Strategy 4: Testing Rosetta 2 fallback...');
    
    const rosettaResult = await testAndSetupRosetta();
    
    switch (rosettaResult) {
      case 'rosetta-ready':
        console.log('✅ Rosetta fallback configured successfully');
        
        // Set environment variable to use the wrapper
        process.env.EMBEDDED_POSTGRES_BINARY_PATH = join(projectRoot, 'scripts', 'postgres-intel-wrapper.sh');
        
        // Test it one more time to be sure
        try {
          await testPostgresBinary();
          console.log('✅ Rosetta postgres test passed!');
          return 'rosetta-fallback';
        } catch (testError) {
          console.log('⚠️ Rosetta postgres still failing, continuing to manual guidance...');
        }
        break;
        
      case 'need-intel-binary':
        console.log('📦 Intel binary not found. You can install it with:');
        console.log('   npm install @embedded-postgres/darwin-x64');
        console.log('   Then re-run the setup');
        break;
        
      case 'intel-binary-broken':
        console.log('⚠️ Intel binary also has dependency issues');
        break;
        
      case 'rosetta-test-failed':
        console.log('⚠️ Rosetta test failed for unknown reasons');
        break;
        
      case 'rosetta-unavailable':
        console.log('⚠️ Rosetta 2 is not available or not installed');
        console.log('💡 Install with: softwareupdate --install-rosetta');
        break;
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