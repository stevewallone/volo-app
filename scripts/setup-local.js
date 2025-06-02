#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeDatabase() {
  const dataDir = path.join(__dirname, '../data/postgres');
  
  console.log('📦 Initializing embedded PostgreSQL database...');
  
  let embeddedPg = null;
  let client = null;
  
  try {
    // Create embedded postgres instance
    embeddedPg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'password',
      port: 5433,
      persistent: true,
    });

    // Initialize and start the server
    await embeddedPg.initialise();
    await embeddedPg.start();
    
    console.log('✅ Embedded PostgreSQL server started');

    // Connect to the database
    const connectionString = 'postgresql://postgres:password@localhost:5433/postgres';
    client = postgres(connectionString);

    // Check if our schema already exists
    const schemaExists = await client`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'app'
    `;

    if (schemaExists.length === 0) {
      console.log('📦 Creating app schema...');
      await client`CREATE SCHEMA app`;
      
      // Read and execute the migration file
      const migrationPath = path.join(__dirname, '../server/drizzle/0000_initial.sql');
      const migrationSQL = await readFile(migrationPath, 'utf-8');
      
      // Modify the SQL to use the app schema
      const schemaAwareSql = migrationSQL.replace(
        'CREATE TABLE IF NOT EXISTS "users"',
        'CREATE TABLE IF NOT EXISTS app.users'
      );
      
      // Execute the migration
      await client.unsafe(schemaAwareSql);
      console.log('✅ Database schema created successfully');
    } else {
      console.log('✅ Database schema already exists');
    }
    
    // Verify that the table was created
    const tableExists = await client`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'app' AND tablename = 'users'
    `;
    
    if (tableExists.length > 0) {
      console.log('✅ Database schema verified');
    } else {
      console.warn('⚠️  Database schema verification failed');
    }

  } catch (error) {
    console.warn('⚠️  Database initialization error:', error.message);
  } finally {
    // Clean up connections
    if (client) {
      await client.end();
    }
    if (embeddedPg) {
      await embeddedPg.stop();
    }
  }
}

async function setupLocalEnvironment() {
  console.log('🚀 Setting up local development environment...');

  try {
    // Create data directory for embedded PostgreSQL
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
    const envPath = path.join(serverDir, '.env');
    const envExamplePath = path.join(serverDir, '.env.example');
    
    if (!existsSync(envPath)) {
      if (existsSync(envExamplePath)) {
        const exampleContent = await readFile(envExamplePath, 'utf-8');
        await writeFile(envPath, exampleContent);
        console.log('✅ Created .env file from .env.example');
      } else {
        console.warn('⚠️  .env.example not found, skipping .env creation');
      }
    } else {
      console.log('✅ Local development environment file (.env) already exists');
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
    console.log('  • Embedded PostgreSQL: postgresql://postgres:password@localhost:5433/postgres');
    console.log('  • Firebase Auth Emulator: http://localhost:9099');
    console.log('  • Firebase Emulator UI: http://localhost:4000');
    console.log('\n💡 You can sign in with any email/password in the Firebase emulator');
    console.log('💡 The PostgreSQL database will persist data between restarts');

  } catch (error) {
    console.error('❌ Error setting up local environment:', error);
    process.exit(1);
  }
}

// Run the setup when script is executed directly
setupLocalEnvironment().catch(console.error);

export { setupLocalEnvironment }; 