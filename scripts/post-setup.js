#!/usr/bin/env node

/**
 * Post-setup script called by create-volo-app CLI
 * Handles template-specific setup tasks after configuration files are generated
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

console.log('🔧 Running post-setup tasks...');

// Check if required config files exist
const requiredFiles = [
  'ui/src/lib/firebase-config.json',
  'server/.dev.vars'
];

for (const file of requiredFiles) {
  const filePath = join(projectRoot, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Required config file missing: ${file}`);
    process.exit(1);
  }
}

/**
 * Parse the database URL to determine if it's Supabase (for specific error handling)
 */
function parseSupabaseInfo(databaseUrl) {
  return {
    isSupabase: databaseUrl.includes('supabase.co')
  };
}

/**
 * Test PostgreSQL database connectivity using external test script
 */
async function testDatabaseConnectivity() {
  try {
    execSync(`npx dotenv-cli -e .dev.vars -- node db-connectivity-test.mjs`, {
      cwd: join(projectRoot, 'server'),
      timeout: 15000,
      stdio: 'pipe'
    });
    
    return {
      connected: true,
      error: null
    };
  } catch (error) {
    const errorMessage = error.message || String(error);
    
    // Check for specific database not ready errors
    const isNotReady = 
      errorMessage.includes('Tenant or user not found') ||
      errorMessage.includes('FATAL') ||
      errorMessage.includes('XX000') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('connection refused') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Connection terminated unexpectedly');

    return {
      connected: false,
      error: errorMessage,
      isNotReady: isNotReady
    };
  }
}

/**
 * Wait for PostgreSQL database to be ready with direct connectivity testing
 */
async function waitForDatabaseReady(maxWaitTime = 120000) { // 2 minutes max
  const startTime = Date.now();
  let attempt = 0;
  
  console.log(`🔍 Testing PostgreSQL database connectivity...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    attempt++;
    const result = await testDatabaseConnectivity();
    
    if (result.connected) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`✅ PostgreSQL database is ready! (${elapsed}s)`);
      return true;
    }
    
    // If it's not a "not ready" error, fail fast
    if (!result.isNotReady) {
      console.log(`❌ Database connection failed with unexpected error: ${result.error}`);
      return false;
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`⏳ PostgreSQL database still starting up... (${elapsed}s elapsed, attempt ${attempt})`);
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log(`⚠️  Database connectivity check timed out after ${maxWaitTime/1000}s, proceeding with schema push...`);
  return false;
}

/**
 * Enhanced retry function that tests database connectivity for all PostgreSQL databases
 */
async function retryDatabasePush(maxRetries = 3) {
  // Read the DATABASE_URL to determine the provider
  const devVarsPath = join(projectRoot, 'server/.dev.vars');
  const devVarsContent = fs.readFileSync(devVarsPath, 'utf8');
  const databaseUrlMatch = devVarsContent.match(/DATABASE_URL=(.+)/);
  
  if (!databaseUrlMatch) {
    throw new Error('DATABASE_URL not found in .dev.vars');
  }
  
  const databaseUrl = databaseUrlMatch[1];
  const supabaseInfo = parseSupabaseInfo(databaseUrl);
  
  // Test database connectivity for all PostgreSQL databases
  console.log('🔍 Testing database connectivity before schema push...');
  await waitForDatabaseReady();
  
  // Now attempt the database push with limited retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync('npx dotenv-cli -e .dev.vars -- pnpm db:push', {
        cwd: join(projectRoot, 'server'),
        stdio: 'inherit'
      });
      
      console.log('✅ Database schema created successfully!');
      return; // Success
    } catch (error) {
      const errorMessage = error.message || String(error);
      const isLastAttempt = attempt === maxRetries;
      
      // Specifically handle database "not ready" errors (common with cloud providers)
      const isDatabaseNotReady = (
        errorMessage.includes('Tenant or user not found') ||
        errorMessage.includes('FATAL') ||
        errorMessage.includes('XX000')
      );
      
      if (isLastAttempt) {
        if (isDatabaseNotReady) {
          console.error('❌ Database is still not ready after multiple attempts.');
          console.log('');
          console.log('💡 This can happen when cloud databases take longer than expected to provision.');
          console.log('   Solutions:');
          console.log('   1. Wait 1-2 minutes and try the manual setup:');
          console.log('      cd server && npx dotenv-cli -e .dev.vars -- pnpm db:push');
          console.log('   2. Check your database provider dashboard to ensure the database is fully active');
          console.log('   3. Verify your connection string is correct');
        }
        throw error; // Re-throw on final attempt
      }
      
      if (isDatabaseNotReady) {
        console.log(`⏳ Database still not ready (attempt ${attempt}/${maxRetries}), waiting 10s...`);
        console.log('   Schema push failed but connectivity test passed - trying again shortly.');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.log(`⏳ Database push failed (attempt ${attempt}/${maxRetries}), retrying in 3s...`);
        console.log(`   Error: ${errorMessage.split('\n')[0]}`); // Just show first line of error
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
}

try {
  // Install dependencies if not already done
  console.log('📦 Installing dependencies...');
  execSync('pnpm install', { cwd: projectRoot, stdio: 'inherit' });

  // Push database schema with intelligent retry for Supabase
  console.log('🗄️  Setting up database schema...');
  await retryDatabasePush();

  console.log('✅ Post-setup complete!');
  console.log('');
  console.log('🚀 Your app is ready! To start development:');
  console.log('   cd your-app-name');
  console.log('   pnpm run dev:start');
  console.log('');
  console.log('📚 Need help? Check the README.md file');

} catch (error) {
  console.error('❌ Post-setup failed:', error.message);
  console.log('');
  console.log('💡 You can complete setup manually by running:');
  console.log('   cd server && npx dotenv-cli -e .dev.vars -- pnpm db:push');
  process.exit(1);
} 