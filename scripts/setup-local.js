#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        // Double-check by trying to connect
        const client = net.createConnection(port, '127.0.0.1');
        client.on('connect', () => {
          client.destroy();
          resolve(false); // Port is actually in use
        });
        client.on('error', () => {
          resolve(true); // Port is available
        });
        // Timeout the connection attempt
        setTimeout(() => {
          client.destroy();
          resolve(true);
        }, 1000);
      });
    });
    server.on('error', () => resolve(false));
  });
}

async function findNextAvailablePort(startPort) {
  let port = startPort;
  let attempts = 0;
  const maxAttempts = 100; // Prevent infinite loops
  
  while (!(await isPortAvailable(port)) && attempts < maxAttempts) {
    port++;
    attempts++;
  }
  
  if (attempts >= maxAttempts) {
    throw new Error(`Could not find an available port starting from ${startPort} after ${maxAttempts} attempts`);
  }
  
  return port;
}

async function findAvailablePostgresPort() {
  // Check if there's already a .env file with a PostgreSQL port
  const envPath = path.join(__dirname, '../server/.env');
  
  if (existsSync(envPath)) {
    try {
      const envContent = await readFile(envPath, 'utf-8');
      const dbUrlMatch = envContent.match(/postgresql:\/\/.*:(\d+)/);
      if (dbUrlMatch) {
        const existingPort = parseInt(dbUrlMatch[1]);
        console.log(`📋 Found existing PostgreSQL configuration on port ${existingPort}`);
        
        // Check if this port is available (meaning our database isn't running)
        const isAvailable = await isPortAvailable(existingPort);
        if (isAvailable) {
          console.log(`✅ Port ${existingPort} is available, will reuse this configuration`);
          return existingPort;
        } else {
          console.log(`⚠️  Port ${existingPort} is in use - checking if it's our database...`);
          
          // Try to connect to see if it's our database
          try {
            const testConnection = `postgresql://postgres:password@localhost:${existingPort}/postgres`;
            const client = postgres(testConnection);
            await client`SELECT 1`;
            await client.end();
            console.log(`🔗 Port ${existingPort} has our database running, will reuse this configuration`);
            return existingPort;
          } catch (error) {
            console.log(`⚠️  Port ${existingPort} is occupied by a different service, finding new port...`);
          }
        }
      }
    } catch (error) {
      console.log('📝 Could not read existing .env file, will create new configuration');
    }
  }

  // Find a new available port starting from 5433
  console.log('🔍 Finding available PostgreSQL port...');
  const newPort = await findNextAvailablePort(5433);
  console.log(`✅ Found available port: ${newPort}`);
  return newPort;
}

async function initializeDatabase(postgresPort) {
  const dataDir = path.join(__dirname, '../data/postgres');
  
  console.log(`📦 Initializing embedded PostgreSQL database on port ${postgresPort}...`);
  
  let embeddedPg = null;
  let client = null;
  
  try {
    // Create embedded postgres instance
    embeddedPg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'password',
      port: postgresPort,
      persistent: true,
    });

    // Initialize and start the server
    await embeddedPg.initialise();
    await embeddedPg.start();
    
    console.log(`✅ Embedded PostgreSQL server started on port ${postgresPort}`);

    // Connect to the database
    const connectionString = `postgresql://postgres:password@localhost:${postgresPort}/postgres`;
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
      if (existsSync(migrationPath)) {
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
        console.log('⚠️  No migration file found, schema will be created when server starts');
      }
    } else {
      console.log('✅ Database schema already exists');
    }
    
    // Verify that the table was created (if migration file existed)
    const migrationPath = path.join(__dirname, '../server/drizzle/0000_initial.sql');
    if (existsSync(migrationPath)) {
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
    }

    return connectionString;

  } catch (error) {
    if (error.message && error.message.includes('postmaster.pid already exists')) {
      console.log('\n🚨 PostgreSQL Database Conflict Detected\n');
      console.log('❌ Another PostgreSQL instance is already running with the same data directory.');
      console.log('   This typically happens when you try to run multiple volo-app instances');
      console.log('   from the same folder.\n');
      console.log('💡 Solutions:');
      console.log('   1. Stop the other volo-app instance first (Ctrl+C)');
      console.log('   2. Copy this project to a different folder if you need multiple instances');
      console.log('   3. Use different PROJECT folders for different volo-apps\n');
      console.log('📁 Current project folder:', path.resolve(__dirname, '..'));
      console.log('🔍 PostgreSQL data directory:', dataDir);
      console.log('\n🔄 If you want to run multiple volo-apps simultaneously:');
      console.log('   • Each should be in its own separate folder');
      console.log('   • The dynamic port system will handle port conflicts automatically');
      console.log('   • Each will get its own PostgreSQL database instance');
      process.exit(1);
    } else {
      console.warn('⚠️  Database initialization error:', error.message);
      throw error;
    }
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

    // Find an available PostgreSQL port
    const postgresPort = await findAvailablePostgresPort();
    
    // Initialize the database
    const connectionString = await initializeDatabase(postgresPort);

    // Create or update local environment file for server
    const serverDir = path.join(__dirname, '../server');
    const envPath = path.join(serverDir, '.env');
    const envExamplePath = path.join(serverDir, '.env.example');
    
    let envContent = '';
    let isNewFile = !existsSync(envPath);
    
    if (existsSync(envExamplePath)) {
      const exampleContent = await readFile(envExamplePath, 'utf-8');
      
      // Replace template variables with local development values
      envContent = exampleContent
        .replace('{{DATABASE_URL}}', connectionString)
        .replace('{{FIREBASE_PROJECT_ID}}', 'demo-project')
        .replace('{{WORKER_NAME}}', 'demo-worker');
    } else {
      // Create basic .env if .env.example doesn't exist
      envContent = `DATABASE_URL=${connectionString}
PORT=8787
FIREBASE_PROJECT_ID=demo-project
WORKER_NAME=demo-worker
`;
      console.log('⚠️  .env.example not found, creating basic .env file');
    }
    
    if (isNewFile) {
      await writeFile(envPath, envContent);
      console.log(`✅ Created .env file with PostgreSQL on port ${postgresPort}`);
    } else {
      // Update existing .env with correct DATABASE_URL
      const existingEnv = await readFile(envPath, 'utf-8');
      const updatedEnv = existingEnv.replace(
        /DATABASE_URL=.*/,
        `DATABASE_URL=${connectionString}`
      );
      
      if (updatedEnv !== existingEnv) {
        await writeFile(envPath, updatedEnv);
        console.log(`✅ Updated .env file with PostgreSQL on port ${postgresPort}`);
      } else {
        console.log('✅ .env file already has correct PostgreSQL configuration');
      }
    }

    // Handle Firebase configuration for local development
    const uiDir = path.join(__dirname, '../ui/src/lib');
    const firebaseConfigPath = path.join(uiDir, 'firebase-config.json');
    
    if (!existsSync(firebaseConfigPath)) {
      // No Firebase config exists, create demo configuration
      await mkdir(uiDir, { recursive: true });
      
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
      // Check if existing config is production or demo
      try {
        const existingConfig = JSON.parse(await readFile(firebaseConfigPath, 'utf-8'));
        const isProductionConfig = existingConfig.projectId !== 'demo-project' && 
                                 existingConfig.apiKey !== 'demo-api-key';
        
        if (isProductionConfig) {
          console.log('✅ Production Firebase configuration detected - keeping existing setup');
          console.log(`   • Project: ${existingConfig.projectId}`);
          console.log('   • Note: Firebase emulator will not be used with production config');
        } else {
          console.log('✅ Demo Firebase configuration already exists');
        }
      } catch (error) {
        console.log('⚠️  Firebase configuration file exists but could not be read, keeping existing');
      }
    }

    // Display setup completion information
    console.log('\n🎉 Local development environment is ready!');
    console.log('\n📋 Configuration Summary:');
    console.log(`  • PostgreSQL Database: port ${postgresPort}`);
    console.log(`  • Database URL: ${connectionString}`);
    console.log('  • Firebase Auth: demo-project (emulator mode)');
    
    console.log('\n💡 You can sign in with any email/password in the Firebase emulator');
    console.log('💡 The PostgreSQL database will persist data between restarts');
    
    console.log('\n🚀 To start developing:');
    console.log('  Run: pnpm run dev');
    console.log('\n✨ The development server will:');
    console.log('  • Automatically find available ports for web services');
    console.log('  • Use your local PostgreSQL database for data persistence');
    console.log('  • Handle port conflicts if running multiple volo-app projects');

  } catch (error) {
    console.error('❌ Error setting up local environment:', error);
    process.exit(1);
  }
}

// Run the setup when script is executed directly
setupLocalEnvironment().catch(console.error);

export { setupLocalEnvironment }; 