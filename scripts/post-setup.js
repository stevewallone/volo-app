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
  // Detect any Supabase URL pattern
  if (!databaseUrl.includes('supabase.co')) {
    return { isSupabase: false };
  }

  let projectRef = null;
  
  // Pattern 1: Pooled connection - postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
  const pooledPattern = /postgresql:\/\/postgres\.([^:]+):[^@]+@aws-0-[^.]+\.pooler\.supabase\.com:\d+\/postgres/;
  const pooledMatch = databaseUrl.match(pooledPattern);
  
  if (pooledMatch) {
    projectRef = pooledMatch[1];
  } else {
    // Pattern 2: Direct connection - postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres  
    const directPattern = /postgresql:\/\/postgres:[^@]+@db\.([^.]+)\.supabase\.co:\d+\/postgres/;
    const directMatch = databaseUrl.match(directPattern);
    
    if (directMatch) {
      projectRef = directMatch[1];
    }
  }
  
  return {
    isSupabase: true,
    projectRef: projectRef,
    hasProjectRef: !!projectRef
  };
}

/**
 * Check Supabase project status using the CLI
 */
async function checkSupabaseProjectStatus(projectRef) {
  try {
    // Check if supabase CLI is available
    execSync('supabase --version', { stdio: 'pipe' });
    
    // Get project status - try different command formats
    let output;
    try {
      output = execSync(`supabase projects get ${projectRef} --output json`, { 
        stdio: 'pipe',
        encoding: 'utf8'
      });
    } catch (error) {
      // Try alternative command format
      output = execSync(`supabase projects list --output json`, { 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      
      const projects = JSON.parse(output);
      const project = projects.find(p => p.id === projectRef || p.name.includes(projectRef));
      
      if (!project) {
        return {
          exists: false,
          ready: false,
          error: 'Project not found in list'
        };
      }
      
      output = JSON.stringify(project);
    }
    
    const project = JSON.parse(output);
    
    // Check various status indicators
    const isReady = 
      project.status === 'ACTIVE_HEALTHY' || 
      project.status === 'ACTIVE' ||
      project.status === 'RUNNING' ||
      !project.status || // Some versions don't have status
      project.status !== 'UNKNOWN'; // Exclude explicitly unknown status
    
    return {
      exists: true,
      ready: isReady,
      project,
      status: project.status || 'unknown'
    };
  } catch (error) {
    // If CLI not available or project not found, we'll rely on connection testing
    return {
      exists: false,
      ready: false, // Changed to false to trigger retry logic
      error: error.message
    };
  }
}

/**
 * Wait for Supabase project to be ready with status checking
 */
async function waitForSupabaseReady(projectRef, maxWaitTime = 90000) { // Increased to 90s
  if (!projectRef) {
    console.log(`ℹ️  Unable to extract project reference from connection string, skipping status check...`);
    return true; // Continue without status check
  }

  const startTime = Date.now();
  let attempt = 0;
  
  console.log(`🔍 Checking Supabase project status (${projectRef})...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    attempt++;
    const status = await checkSupabaseProjectStatus(projectRef);
    
    if (status.ready) {
      if (status.exists) {
        console.log(`✅ Supabase project is ready! (Status: ${status.status})`);
      } else {
        console.log(`ℹ️  Unable to check status via CLI, proceeding with connection attempt...`);
      }
      return true;
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const statusMsg = status.status ? ` (Status: ${status.status})` : '';
    console.log(`⏳ Supabase project still initializing${statusMsg}... (${elapsed}s elapsed, attempt ${attempt})`);
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log(`⚠️  Supabase project status check timed out after ${maxWaitTime/1000}s, proceeding anyway...`);
  return false;
}

/**
 * Enhanced retry function that checks Supabase status when applicable
 */
async function retryDatabasePush(maxRetries = 5) { // Increased retries
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
      
      console.log('✅ Database schema created successfully!');
      return; // Success
    } catch (error) {
      const errorMessage = error.message || String(error);
      const isLastAttempt = attempt === maxRetries;
      
      // Specifically handle Supabase "Tenant or user not found" errors
      const isSupabaseTenantError = supabaseInfo.isSupabase && (
        errorMessage.includes('Tenant or user not found') ||
        errorMessage.includes('FATAL') ||
        errorMessage.includes('XX000')
      );
      
      if (isLastAttempt) {
        if (isSupabaseTenantError) {
          console.error('❌ Supabase database is still not ready after multiple attempts.');
          console.log('');
          console.log('💡 This can happen when Supabase takes longer than expected to provision.');
          console.log('   Solutions:');
          console.log('   1. Wait 2-3 minutes and try the manual setup:');
          console.log('      cd server && npx dotenv-cli -e .dev.vars -- pnpm db:push');
          console.log('   2. Check your Supabase dashboard to ensure the project is fully active');
          console.log('   3. Verify your connection string is correct');
        }
        throw error; // Re-throw on final attempt
      }
      
      if (isSupabaseTenantError) {
        const waitTime = Math.min(10000 + (attempt * 2000), 20000); // Progressive backoff, max 20s
        console.log(`⏳ Supabase database not ready yet (attempt ${attempt}/${maxRetries}), waiting ${waitTime/1000}s...`);
        console.log('   This is normal for newly created Supabase projects - they need time to fully initialize.');
      } else {
        console.log(`⏳ Database push failed (attempt ${attempt}/${maxRetries}), retrying in 3s...`);
        console.log(`   Error: ${errorMessage.split('\n')[0]}`); // Just show first line of error
      }
      
      const delayMs = isSupabaseTenantError ? (10000 + (attempt * 2000)) : 3000;
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