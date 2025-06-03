#!/usr/bin/env node
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkDependencies() {
  // Check if concurrently is available
  return new Promise((resolve) => {
    const child = spawn('npx', ['concurrently', '--version'], { 
      stdio: 'pipe',
      shell: true 
    });
    child.on('exit', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => resolve(false));
    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
  });
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
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

async function getAvailablePorts() {
  // Read intended ports from .env if it exists
  const envPath = path.join(__dirname, '../server/.env');
  let envPorts = {
    backend: 8787,
    frontend: 5173,
    postgres: 5433,
    firebaseAuth: 9099,
    firebaseUI: 4000
  };

  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const portMatch = envContent.match(/PORT=(\d+)/);
      if (portMatch) {
        envPorts.backend = parseInt(portMatch[1]);
      }
      
      const dbUrlMatch = envContent.match(/postgresql:\/\/.*:(\d+)/);
      if (dbUrlMatch) {
        envPorts.postgres = parseInt(dbUrlMatch[1]);
        console.log(`📋 Using PostgreSQL port ${envPorts.postgres} from .env configuration`);
      }
    } catch (error) {
      console.log('📝 Note: Could not read .env file, using defaults');
      console.log('💡 Run `pnpm run setup:local` to create local configuration');
    }
  } else {
    console.log('⚠️  No .env file found. Run `pnpm run setup:local` first to set up your database.');
    process.exit(1);
  }

  // Check availability and find alternatives if needed
  // All services can use dynamic ports for multi-instance support
  const availablePorts = {};
  for (const [service, port] of Object.entries(envPorts)) {
    try {
      availablePorts[service] = await isPortAvailable(port) 
        ? port 
        : await findNextAvailablePort(port);
    } catch (error) {
      console.error(`❌ Error finding available port for ${service}:`, error.message);
      process.exit(1);
    }
  }

  return { intended: envPorts, available: availablePorts };
}

async function createTempFirebaseConfig(authPort, uiPort) {
  const firebaseConfigPath = path.join(__dirname, '../firebase.json');
  const tempFirebaseConfigPath = path.join(__dirname, '../firebase.temp.json');
  
  if (!existsSync(firebaseConfigPath)) {
    console.warn('⚠️  firebase.json not found, Firebase emulator may not work properly');
    return null;
  }

  try {
    // Read original firebase config
    const originalConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf-8'));
    
    // Create temp config with new ports
    const tempConfig = {
      ...originalConfig,
      emulators: {
        ...originalConfig.emulators,
        auth: {
          ...originalConfig.emulators.auth,
          port: authPort,
          host: '127.0.0.1'
        },
        ui: {
          ...originalConfig.emulators.ui,
          port: uiPort,
          host: '127.0.0.1'
        }
      }
    };
    
    writeFileSync(tempFirebaseConfigPath, JSON.stringify(tempConfig, null, 2));
    return tempFirebaseConfigPath;
  } catch (error) {
    console.warn('⚠️  Error creating temporary Firebase config:', error.message);
    return null;
  }
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  return {
    useWrangler: args.includes('--wrangler') || args.includes('--cloudflare'),
    help: args.includes('--help') || args.includes('-h')
  };
}

function showHelp() {
  console.log(`
🌊 volo-app Development Server

Usage:
  npm run dev                    Start with Node.js server (default)
  npm run dev -- --wrangler     Start with Cloudflare Wrangler dev server
  npm run dev -- --cloudflare   Same as --wrangler
  npm run dev -- --help         Show this help

Features:
  ✅ Automatic port conflict detection and resolution
  ✅ Multiple instance support (run several volo-apps simultaneously)
  ✅ Cloudflare Workers compatibility
  ✅ Firebase emulator integration
  ✅ Hot reload for all services

Notes:
  • When using --wrangler, embedded PostgreSQL is not available
  • For Cloudflare Workers, ensure DATABASE_URL points to a remote database
  • Port assignments are displayed on startup
  • Each volo-app project should be run from its own folder
`);
}

async function checkDatabaseConfiguration(useWrangler) {
  const envPath = path.join(__dirname, '../server/.env');
  
  if (!existsSync(envPath)) {
    if (useWrangler) {
      console.log('⚠️  Warning: No .env file found. Cloudflare Workers requires DATABASE_URL to be set.');
      console.log('   Please create server/.env with a remote database URL.');
      return false;
    }
    return true; // Node.js can use embedded postgres
  }

  const envContent = readFileSync(envPath, 'utf-8');
  const dbUrl = envContent.match(/DATABASE_URL=(.+)/)?.[1];

  if (useWrangler) {
    if (!dbUrl || dbUrl.includes('localhost:5433')) {
      console.log('🚨 Cloudflare Workers Configuration Issue:');
      console.log('   Embedded PostgreSQL cannot run in Cloudflare Workers environment.');
      console.log('   Please update DATABASE_URL in server/.env to point to a remote database.');
      console.log('   Supported options:');
      console.log('   • Neon (recommended): postgresql://user:pass@host.neon.tech/db');
      console.log('   • PostgreSQL on Railway, Supabase, or other cloud providers');
      console.log('');
      return false;
    }
  }

  return true;
}

async function startServices() {
  const cliArgs = parseCliArgs();
  
  if (cliArgs.help) {
    showHelp();
    return;
  }

  // Check if concurrently is available
  console.log('🔍 Checking dependencies...');
  const concurrentlyAvailable = await checkDependencies();
  if (!concurrentlyAvailable) {
    console.error('❌ Error: concurrently is not available.');
    console.error('   This is required to run multiple services simultaneously.');
    console.error('   Please ensure the dependency is installed with: npm install');
    process.exit(1);
  }

  console.log('🔍 Checking port availability...\n');
  
  const { intended, available } = await getAvailablePorts();
  
  // Check database configuration for wrangler mode
  const dbConfigOk = await checkDatabaseConfiguration(cliArgs.useWrangler);
  if (!dbConfigOk) {
    process.exit(1);
  }

  // Show port assignments
  console.log('🔌 Port assignments:');
  Object.entries(available).forEach(([service, port]) => {
    const status = port === intended[service] ? '✅' : '🔄';
    const statusText = port === intended[service] ? 'intended' : `fallback (${intended[service]} occupied)`;
    
    console.log(`  ${status} ${service}: ${port} (${statusText})`);
  });
  console.log('');

  // Show runtime mode
  if (cliArgs.useWrangler) {
    console.log('⚡ Starting in Cloudflare Workers mode (wrangler dev)');
    console.log('📡 Using remote database (embedded PostgreSQL disabled)\n');
  } else {
    console.log('🚀 Starting in Node.js mode');
    console.log('🗄️  Using embedded PostgreSQL (or configured DATABASE_URL)\n');
  }

  // Create temporary Firebase config with dynamic ports
  const tempConfigPath = await createTempFirebaseConfig(available.firebaseAuth, available.firebaseUI);
  const firebaseConfigArg = tempConfigPath ? ` --config ${tempConfigPath}` : '';

  // Build the command arguments based on runtime mode
  let commands;
  
  if (cliArgs.useWrangler) {
    // Cloudflare Workers mode - use wrangler dev
    commands = [
      `"firebase emulators:start --only auth --project demo-project${firebaseConfigArg} --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && wrangler dev --port ${available.backend} --local-protocol http"`,
      `"cd ui && pnpm run dev -- --port ${available.frontend} --api-url http://localhost:${available.backend} --open"`
    ];
  } else {
    // Node.js mode - use tsx watch
    commands = [
      `"firebase emulators:start --only auth --project demo-project${firebaseConfigArg} --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && pnpm run dev -- --port ${available.backend} --postgres-port ${available.postgres}"`,
      `"cd ui && pnpm run dev -- --port ${available.frontend} --api-url http://localhost:${available.backend} --open"`
    ];
  }

  console.log('🚀 Starting services...\n');
  
  // Add a small delay to ensure port detection is accurate
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Use concurrently to run all services
  const child = spawn('npx', ['concurrently', ...commands], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..')
  });

  // Handle graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down services...`);
    
    // Kill child process tree (Windows and Unix compatible)
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', child.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    
    // Clean up temp firebase config
    setTimeout(() => {
      try {
        if (tempConfigPath && existsSync(tempConfigPath)) {
          unlinkSync(tempConfigPath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
      
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGBREAK', () => shutdown('SIGBREAK')); // Windows specific

  child.on('exit', (code) => {
    console.log(`\n✅ Services stopped with code ${code}`);
    
    // Clean up temp firebase config
    try {
      if (tempConfigPath && existsSync(tempConfigPath)) {
        unlinkSync(tempConfigPath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
    
    process.exit(code);
  });

  child.on('error', (error) => {
    console.error('❌ Error starting services:', error.message);
    
    // Clean up temp firebase config
    try {
      if (tempConfigPath && existsSync(tempConfigPath)) {
        unlinkSync(tempConfigPath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
    
    process.exit(1);
  });
}

startServices().catch((error) => {
  console.error('❌ Failed to start services:', error);
  process.exit(1);
}); 