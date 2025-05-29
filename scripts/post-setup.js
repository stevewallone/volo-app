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
 * Parse the database URL to determine if it's Supabase and extract project reference
 */
function parseSupabaseInfo(databaseUrl) {
  // Supabase URLs follow pattern: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
  const supabasePattern = /postgresql:\/\/postgres\.([^:]+):[^@]+@aws-0-[^.]+\.pooler\.supabase\.com:5432\/postgres/;
  const match = databaseUrl.match(supabasePattern);
  
  if (match) {
    return {
      isSupabase: true,
      projectRef: match[1]
    };
  }
  
  return { isSupabase: false };
}

/**
 * Check Supabase project status using the CLI
 */
async function checkSupabaseProjectStatus(projectRef) {
  try {
    // Check if supabase CLI is available
    execSync('supabase --version', { stdio: 'pipe' });
    
    // Get project status
    const output = execSync(`supabase projects get ${projectRef} --output json`, { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    const project = JSON.parse(output);
    
    // Check if project is fully ready
    // Supabase projects typically have a status field or we can infer readiness
    return {
      exists: true,
      ready: project && (project.status === 'ACTIVE_HEALTHY' || project.status === 'ACTIVE' || !project.status), // Some versions don't have status
      project
    };
  } catch (error) {
    // If CLI not available or project not found, assume it might be ready and let connection attempt decide
    return {
      exists: false,
      ready: true, // Assume ready if we can't check
      error: error.message
    };
  }
}

/**
 * Wait for Supabase project to be ready with status checking
 */
async function waitForSupabaseReady(projectRef, maxWaitTime = 60000) {
  const startTime = Date.now();
  let attempt = 0;
  
  console.log(`🔍 Checking Supabase project status (${projectRef})...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    attempt++;
    const status = await checkSupabaseProjectStatus(projectRef);
    
    if (status.ready) {
      if (status.exists) {
        console.log(`✅ Supabase project is ready!`);
      } else {
        console.log(`ℹ️  Unable to check status via CLI, proceeding with connection attempt...`);
      }
      return true;
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`⏳ Supabase project still initializing... (${elapsed}s elapsed, attempt ${attempt})`);
    
    // Wait 3 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log(`⚠️  Supabase project status check timed out after ${maxWaitTime/1000}s, proceeding anyway...`);
  return false;
}

/**
 * Enhanced retry function that checks Supabase status when applicable
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
  
  // If it's Supabase, check the project status first
  if (supabaseInfo.isSupabase) {
    console.log('🔍 Detected Supabase database, checking project readiness...');
    await waitForSupabaseReady(supabaseInfo.projectRef);
  }
  
  // Now attempt the database push with limited retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync('npx dotenv-cli -e .dev.vars -- pnpm db:push', {
        cwd: join(projectRoot, 'server'),
        stdio: 'inherit'
      });
      return; // Success
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        throw error; // Re-throw on final attempt
      }
      
      if (supabaseInfo.isSupabase) {
        console.log(`⏳ Database connection failed (attempt ${attempt}/${maxRetries}), retrying in 5s...`);
        console.log('   This can happen if Supabase is still finishing initialization...');
      } else {
        console.log(`⏳ Database push failed (attempt ${attempt}/${maxRetries}), retrying in 3s...`);
      }
      
      const delayMs = supabaseInfo.isSupabase ? 5000 : 3000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
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