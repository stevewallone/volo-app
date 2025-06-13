#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { glob } from 'glob';
import EmbeddedPostgres from 'embedded-postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

/**
 * Test embedded postgres setup with different configurations
 */
async function testEmbeddedPostgres() {
  console.log('🧪 Testing embedded PostgreSQL configurations...\n');
  
  // Test 1: Check if postgres binaries exist
  console.log('1️⃣ Checking for postgres binaries...');
  
  const binaryPaths = [
    'node_modules/.pnpm/@embedded-postgres+darwin-arm64@*/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres',
    'node_modules/.pnpm/@embedded-postgres+darwin-x64@*/node_modules/@embedded-postgres/darwin-x64/native/bin/postgres',
    'node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres',
    'node_modules/@embedded-postgres/darwin-x64/native/bin/postgres'
  ];
  
  const foundBinaries = [];
  for (const pattern of binaryPaths) {
    const matches = glob.sync(pattern, { cwd: projectRoot });
    for (const match of matches) {
      const fullPath = join(projectRoot, match);
      if (existsSync(fullPath)) {
        foundBinaries.push({ path: fullPath, type: match.includes('arm64') ? 'ARM64' : 'x64' });
      }
    }
  }
  
  if (foundBinaries.length === 0) {
    console.log('❌ No postgres binaries found');
    console.log('💡 Run: npm install embedded-postgres');
    return;
  }
  
  for (const binary of foundBinaries) {
    console.log(`✅ Found ${binary.type} binary: ${binary.path}`);
  }
  
  // Test 2: Test binary versions
  console.log('\n2️⃣ Testing binary versions...');
  
  for (const binary of foundBinaries) {
    try {
      console.log(`\n🔍 Testing ${binary.type} binary:`);
      
      // Test direct execution
      try {
        const directResult = execSync(`"${binary.path}" --version`, { 
          encoding: 'utf8', 
          timeout: 5000,
          stdio: 'pipe'
        });
        console.log(`  ✅ Direct execution: ${directResult.trim()}`);
      } catch (directError) {
        console.log(`  ❌ Direct execution failed: ${directError.message}`);
        
        // If this is an ARM64 binary and we're on Apple Silicon, try to diagnose the libzstd issue
        if (binary.type === 'ARM64' && process.platform === 'darwin' && process.arch === 'arm64') {
          if (directError.message.includes('Abort trap') || directError.message.includes('SIGABRT')) {
            console.log('  🔍 This looks like the libzstd issue we\'re trying to fix');
          }
        }
      }
      
      // If this is x64 binary, test with Rosetta
      if (binary.type === 'x64' && process.platform === 'darwin') {
        try {
          const rosettaResult = execSync(`arch -x86_64 "${binary.path}" --version`, { 
            encoding: 'utf8', 
            timeout: 5000,
            stdio: 'pipe'
          });
          console.log(`  ✅ Rosetta execution: ${rosettaResult.trim()}`);
        } catch (rosettaError) {
          console.log(`  ❌ Rosetta execution failed: ${rosettaError.message}`);
        }
      }
      
    } catch (error) {
      console.log(`  ❌ Failed to test ${binary.type} binary: ${error.message}`);
    }
  }
  
  // Test 3: Test embedded postgres initialization
  console.log('\n3️⃣ Testing embedded postgres initialization...');
  
  try {
    const tempDataDir = join(projectRoot, 'temp-test-data');
    
    const embeddedPg = new EmbeddedPostgres({
      databaseDir: tempDataDir,
      user: 'test',
      password: 'test',
      port: 5435, // Use a different port for testing
      persistent: false
    });
    
    console.log('🚀 Attempting to initialize...');
    await embeddedPg.initialise();
    
    console.log('▶️ Attempting to start...');
    await embeddedPg.start();
    
    console.log('✅ Embedded postgres started successfully!');
    
    console.log('🛑 Stopping test instance...');
    await embeddedPg.stop();
    
    console.log('✅ Test completed successfully');
    
    // Cleanup
    try {
      execSync(`rm -rf "${tempDataDir}"`);
    } catch (e) {
      // Cleanup failed, but that's ok for a test
    }
    
  } catch (initError) {
    console.log(`❌ Embedded postgres initialization failed: ${initError.message}`);
    
    if (initError.message.includes('libzstd')) {
      console.log('\n💡 This is the libzstd issue! Run the main setup script to fix it.');
    }
  }
  
  console.log('\n🏁 Test complete!');
}

// Run the test
testEmbeddedPostgres().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
}); 