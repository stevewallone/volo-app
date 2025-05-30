#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeDatabase() {
  const dbPath = path.join(__dirname, '../data/local.db');
  const dbExists = existsSync(dbPath);
  
  try {
    const client = new PGlite(dbPath);

    if (!dbExists) {
      console.log('📦 Creating new local database...');
      
      // Create the app schema first
      await client.exec('CREATE SCHEMA IF NOT EXISTS app;');
      
      // Read and execute the migration file
      const migrationPath = path.join(__dirname, '../server/drizzle/0000_initial.sql');
      const migrationSQL = await readFile(migrationPath, 'utf-8');
      
      // Modify the SQL to use the app schema
      const schemaAwareSql = migrationSQL.replace(
        'CREATE TABLE IF NOT EXISTS "users"',
        'CREATE TABLE IF NOT EXISTS app.users'
      );
      
      await client.exec(schemaAwareSql);
      console.log('✅ Initialized local database with schema');
    } else {
      console.log('✅ Local database already exists');
    }

    await client.close();
  } catch (error) {
    console.warn('⚠️  Database initialization skipped:', error.message);
  }
}

async function setupLocalEnvironment() {
  console.log('🚀 Setting up local development environment...');

  try {
    // Create data directory for PGlite database
    const dataDir = path.join(__dirname, '../data');
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true });
      console.log('✅ Created data directory for local database');
    } else {
      console.log('✅ Data directory already exists');
    }

    // Initialize the database
    await initializeDatabase();

    // Create local environment file for server if it doesn't exist
    const serverDir = path.join(__dirname, '../server');
    const devVarsPath = path.join(serverDir, '.dev.vars');
    
    if (!existsSync(devVarsPath)) {
      const localConfig = `# Local development configuration
# No DATABASE_URL needed - will use PGlite automatically
FIREBASE_PROJECT_ID=demo-project
NODE_ENV=development
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
`;
      await writeFile(devVarsPath, localConfig);
      console.log('✅ Created local development configuration');
    } else {
      console.log('✅ Local development configuration already exists');
    }

    // Ensure local Firebase config exists with demo values
    const uiDir = path.join(__dirname, '../ui/src/lib');
    const firebaseConfigPath = path.join(uiDir, 'firebase-config.json');
    
    if (!existsSync(firebaseConfigPath)) {
      const demoFirebaseConfig = {
        "apiKey": "demo-api-key",
        "authDomain": "demo-project.firebaseapp.com",
        "projectId": "demo-project",
        "storageBucket": "demo-project.appspot.com",
        "messagingSenderId": "123456789",
        "appId": "1:123456789:web:abcdef123456",
        "measurementId": "G-XXXXXXXXXX"
      };
      await writeFile(firebaseConfigPath, JSON.stringify(demoFirebaseConfig, null, 2));
      console.log('✅ Created demo Firebase configuration');
    } else {
      console.log('✅ Demo Firebase configuration already exists');
    }

    console.log('\n🎉 Local development environment is ready!');
    console.log('\nServices will be available at:');
    console.log('  • Frontend: http://localhost:5173');
    console.log('  • Backend API: http://localhost:8787');
    console.log('  • Firebase Auth Emulator: http://localhost:9099');
    console.log('  • Firebase Emulator UI: http://localhost:4000');
    console.log('\n💡 You can sign in with any email/password in the Firebase emulator');

  } catch (error) {
    console.error('❌ Error setting up local environment:', error);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupLocalEnvironment();
}

export { setupLocalEnvironment }; 