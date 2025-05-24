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

try {
  // Install dependencies if not already done
  console.log('📦 Installing dependencies...');
  execSync('pnpm install', { cwd: projectRoot, stdio: 'inherit' });

  // Push database schema
  console.log('🗄️  Setting up database schema...');
  execSync('npx dotenv-cli -e .dev.vars -- pnpm db:push', { 
    cwd: join(projectRoot, 'server'), 
    stdio: 'inherit' 
  });

  console.log('✅ Post-setup complete!');
  console.log('');
  console.log('🚀 Your app is ready! To start development:');
  console.log('   cd your-app-name');
  console.log('   pnpm dev:start');
  console.log('');
  console.log('📚 Need help? Check the README.md file');

} catch (error) {
  console.error('❌ Post-setup failed:', error.message);
  console.log('');
  console.log('💡 You can complete setup manually by running:');
  console.log('   cd server && npx dotenv-cli -e .dev.vars -- pnpm db:push');
  process.exit(1);
} 