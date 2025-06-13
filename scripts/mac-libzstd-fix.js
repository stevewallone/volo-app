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
  
  console.log('🔍 Checking for Mac libzstd compatibility issues...');
  
  try {
    // Try to find embedded postgres binaries using glob patterns
    const searchPatterns = [
      'node_modules/.pnpm/@embedded-postgres+darwin-arm64@*/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres',
      'node_modules/.pnpm/@embedded-postgres+darwin-x64@*/node_modules/@embedded-postgres/darwin-x64/native/bin/postgres',
      'node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres',
      'node_modules/@embedded-postgres/darwin-x64/native/bin/postgres'
    ];
    
    let foundBinary = null;
    
    for (const pattern of searchPatterns) {
      console.log(`🔍 Searching for: ${pattern}`);
      try {
        const matches = glob.sync(pattern, { cwd: projectRoot });
        if (matches.length > 0) {
          foundBinary = join(projectRoot, matches[0]);
          console.log(`✅ Found postgres binary: ${foundBinary}`);
          break;
        }
      } catch (globError) {
        console.log(`⚠️ Search failed for ${pattern}: ${globError.message}`);
      }
    }
    
    if (!foundBinary) {
      console.log('⚠️ No embedded postgres binary found - assuming no libzstd issue');
      console.log('💡 If you haven\'t installed embedded-postgres yet, run: npm install embedded-postgres');
      return false;
    }
    
    console.log(`🧪 Testing postgres binary: ${foundBinary}`);
    return await testPostgresBinary(foundBinary);
    
  } catch (error) {
    console.log('⚠️ Error during libzstd detection:', error.message);
    // If we can't detect, assume there might be an issue and let the user know
    console.log('🤔 Unable to test postgres binary - proceeding with caution');
    return false;
  }
}

/**
 * Test if a postgres binary fails due to libzstd issues
 */
async function testPostgresBinary(binaryPath) {
  if (!existsSync(binaryPath)) {
    console.log(`❌ Binary not found: ${binaryPath}`);
    return false;
  }
  
  try {
    console.log('🧪 Testing postgres binary with --version...');
    const result = execSync(`"${binaryPath}" --version`, { 
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'pipe'
    });
    
    console.log(`✅ Postgres binary test passed: ${result.trim()}`);
    return false; // Binary works fine, no libzstd issue
    
  } catch (error) {
    console.log('⚠️ Postgres binary test failed, analyzing error...');
    
    // Get detailed error information
    const errorMessage = error.message || '';
    const errorStderr = error.stderr?.toString() || '';
    const errorStdout = error.stdout?.toString() || '';
    const signal = error.signal;
    
    console.log(`🔍 Error details:`);
    console.log(`   Signal: ${signal}`);
    console.log(`   Message: ${errorMessage.substring(0, 200)}`);
    if (errorStderr) console.log(`   Stderr: ${errorStderr.substring(0, 200)}`);
    if (errorStdout) console.log(`   Stdout: ${errorStdout.substring(0, 200)}`);
    
    // Check for libzstd-related issues
    const allErrorText = `${errorMessage} ${errorStderr} ${errorStdout}`.toLowerCase();
    
    const hasLibzstdIssue = 
      allErrorText.includes('libzstd.1.dylib') ||
      allErrorText.includes('library not loaded') ||
      signal === 'SIGABRT' ||
      errorMessage.includes('Abort trap: 6') ||
      allErrorText.includes('dyld') && allErrorText.includes('library');
    
    if (hasLibzstdIssue) {
      console.log('✅ Confirmed: libzstd compatibility issue detected');
      return true;
    } else {
      console.log('❌ Different issue detected (not libzstd related)');
      console.log('💡 This might be a different postgres configuration issue');
      return false;
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
  console.log('🔧 Starting Mac libzstd compatibility fix...');
  
  try {
    // Detect architecture
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const isAppleSilicon = arch === 'arm64';
    
    console.log(`📱 Detected ${isAppleSilicon ? 'Apple Silicon (ARM64)' : 'Intel (x86_64)'} Mac`);
    
    // Create lib directory structure
    const libDirs = [];
    
    // Find all embedded postgres installations and create lib dirs for each
    try {
      console.log('🔍 Searching for embedded postgres installations...');
      const searchResult = execSync(`find ${projectRoot} -path "*/node_modules/@embedded-postgres/darwin-*/native/bin" -type d 2>/dev/null`, { encoding: 'utf8' });
      const binDirs = searchResult.trim().split('\n').filter(Boolean);
      
      console.log(`📦 Found ${binDirs.length} embedded postgres installation(s)`);
      
      for (const binDir of binDirs) {
        const libDir = join(dirname(binDir), 'lib');
        libDirs.push(libDir);
        
        if (!existsSync(libDir)) {
          await mkdir(libDir, { recursive: true });
          console.log(`📁 Created lib directory: ${libDir}`);
        } else {
          console.log(`📁 Using existing lib directory: ${libDir}`);
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
          console.log(`📁 Created fallback lib directory: ${libPath}`);
        } catch (e) {
          // Directory may not exist, that's ok
        }
      }
    }
    
    if (libDirs.length === 0) {
      throw new Error('Could not find or create lib directories for embedded postgres. Make sure embedded-postgres is installed.');
    }
    
    console.log(`🎯 Target directories: ${libDirs.length} lib folder(s)`);
    
    const libzstdFilename = 'libzstd.1.dylib';
    
    // Strategy 1: Try to find libzstd locally first (if user has Homebrew already installed)
    console.log('🔍 Strategy 1: Checking for existing libzstd installation...');
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
      console.log(`✅ Found local libzstd at: ${sourcePath}`);
      
      // Copy to all lib directories
      let copySuccess = false;
      for (const libDir of libDirs) {
        const targetPath = join(libDir, libzstdFilename);
        try {
          // Use cp command to preserve permissions and links
          execSync(`cp "${sourcePath}" "${targetPath}"`);
          console.log(`✅ Copied libzstd to: ${targetPath}`);
          copySuccess = true;
        } catch (error) {
          console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
        }
      }
      
      if (copySuccess) {
        console.log('🎉 Strategy 1 successful - using existing libzstd');
        return true;
      }
    }
    
    // Strategy 2: Try automated Homebrew install (if available)
    console.log('🔍 Strategy 2: Attempting automated Homebrew installation...');
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
        let copySuccess = false;
        for (const libDir of libDirs) {
          const targetPath = join(libDir, libzstdFilename);
          try {
            execSync(`cp "${sourcePath}" "${targetPath}"`);
            console.log(`✅ Copied libzstd to: ${targetPath}`);
            copySuccess = true;
          } catch (error) {
            console.log(`⚠️ Failed to copy to ${targetPath}: ${error.message}`);
          }
        }
        
        if (copySuccess) {
          console.log('🎉 Strategy 2 successful - installed via Homebrew');
          return true;
        }
      }
    } catch (error) {
      console.log('⚠️ Homebrew not available or installation failed');
    }
    
    // Strategy 3: Download from alternative sources
    console.log('🔍 Strategy 3: Attempting direct download...');
    const downloadSuccess = await downloadLibzstdFromBottle(arch, libDirs);
    if (downloadSuccess) {
      console.log('🎉 Strategy 3 successful - downloaded and built libzstd');
      return true;
    }
    
    // Strategy 4: Rosetta fallback (Apple Silicon only)
    if (arch === 'arm64') {
      console.log('🔍 Strategy 4: Testing Rosetta 2 fallback...');
      
      const rosettaResult = await testAndSetupRosetta();
      
      switch (rosettaResult) {
        case 'rosetta-ready':
          console.log('✅ Rosetta fallback configured successfully');
          
          // Set environment variable to use the wrapper
          process.env.EMBEDDED_POSTGRES_BINARY_PATH = join(projectRoot, 'scripts', 'postgres-intel-wrapper.sh');
          
          console.log('🎉 Strategy 4 successful - using Rosetta fallback');
          return 'rosetta-fallback';
          
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
    
    // All strategies failed
    console.log('❌ All automatic fix strategies failed');
    return false;
    
  } catch (error) {
    console.log(`❌ Error during libzstd fix: ${error.message}`);
    return false;
  } finally {
    // Always cleanup temp directory
    await cleanupTempDir();
  }
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

// Cleanup temp directory helper
async function cleanupTempDir() {
  try {
    const tempDir = join(projectRoot, '.temp-libzstd');
    if (existsSync(tempDir)) {
      execSync(`rm -rf "${tempDir}"`);
      console.log('🧹 Cleaned up temporary directory');
    }
  } catch (e) {
    console.log('⚠️ Failed to cleanup temp directory (this is usually fine)');
  }
} 