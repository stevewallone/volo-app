#!/usr/bin/env node
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import getPort from 'get-port';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store original .env content for restoration
let originalEnvContent = null;
let envPath = null;

async function getAvailablePorts() {
  const defaultPorts = {
    backend: 5500,
    frontend: 5501,
    postgres: 5502,
    firebaseAuth: 5503,
    firebaseUI: 5504
  };

  const availablePorts = {};
  let basePort = 5500;

  // Try to find a clean block of 5 consecutive ports
  while (basePort < 10000) { // Reasonable upper limit
    const ports = {
      backend: basePort,
      frontend: basePort + 1,
      postgres: basePort + 2,
      firebaseAuth: basePort + 3,
      firebaseUI: basePort + 4
    };

    // Check if all ports in this block are available
    let allAvailable = true;
    for (const [service, port] of Object.entries(ports)) {
      const testPort = await getPort({ port });
      if (testPort !== port) {
        allAvailable = false;
        break;
      }
    }

    if (allAvailable) {
      // Found a clean block, use these ports
      return ports;
    }

    // Jump to next 100-port block
    basePort += 100;
  }

  // Fallback: if we can't find a clean block, use any available ports
  for (const [service, defaultPort] of Object.entries(defaultPorts)) {
    availablePorts[service] = await getPort();
  }
  
  return availablePorts;
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
  npm run dev -- --help         Show this help

Features:
  ✅ Automatic port conflict detection and resolution
  ✅ Multiple instance support (run several volo-apps simultaneously)
  ✅ Cloudflare Workers compatibility

Notes:
  • When using --wrangler, embedded PostgreSQL is not available
  • For Cloudflare Workers, ensure DATABASE_URL points to a remote database
`);
}

function handleError(error, message = 'Failed to start services') {
  console.error(`❌ ${message}:`, error.message || error);
  process.exit(1);
}

function checkDatabaseConfiguration(useWrangler) {
  const envPath = path.join(__dirname, '../server/.env');
  if (!existsSync(envPath)) {
    if (useWrangler) {
      console.error('❌ No .env file found. Cloudflare Workers requires DATABASE_URL to be set.');
      console.error('   Please create server/.dev.vars with a remote database URL.');
      return false;
    }
    console.error('❌ No .env file found. Run `pnpm run setup:local` first to set up your database.');
    return false;
  }

  if (!useWrangler) return true; // Node.js mode can use embedded postgres

  const envContent = readFileSync(envPath, 'utf-8');
  const dbUrl = envContent.match(/DATABASE_URL=(.+)/)?.[1];

  if (!dbUrl || dbUrl.includes('localhost')) {
    console.error('❌ Cloudflare Workers Configuration Issue:');
    console.error('   Embedded PostgreSQL cannot run in Cloudflare Workers environment.');
    console.error('   Please update DATABASE_URL in server/.dev.vars to point to a remote database.');
    console.error('   Supported options:');
    console.error('   • Neon (recommended): postgresql://user:pass@host.neon.tech/db');
    console.error('   • Supabase, Railway, or other PostgreSQL providers');
    return false;
  }

  return true;
}

async function createFirebaseConfig(availablePorts) {
  const firebaseConfigPath = path.join(__dirname, '../firebase.json');
  const tempFirebaseConfig = {
    emulators: {
      auth: {
        port: availablePorts.firebaseAuth
      },
      ui: {
        enabled: true,
        port: availablePorts.firebaseUI
      }
    }
  };
  
  // Write temporary config
  writeFileSync(firebaseConfigPath, JSON.stringify(tempFirebaseConfig, null, 2));
  
  return firebaseConfigPath;
}

function updateEnvWithDynamicPorts(availablePorts, useWrangler) {
  if (useWrangler) {
    // For Wrangler mode, don't modify .env as it should use remote database
    return;
  }

  envPath = path.join(__dirname, '../server/.env');
  
  if (!existsSync(envPath)) {
    console.error('❌ No .env file found. Cannot update dynamic PostgreSQL port.');
    return;
  }

  try {
    // Read and store original content
    originalEnvContent = readFileSync(envPath, 'utf-8');
    
    // Update DATABASE_URL with dynamic PostgreSQL port
    const updatedContent = originalEnvContent.replace(
      /DATABASE_URL=postgresql:\/\/postgres:password@localhost:\d+\/postgres/,
      `DATABASE_URL=postgresql://postgres:password@localhost:${availablePorts.postgres}/postgres`
    );
    
    // Only write if content actually changed
    if (updatedContent !== originalEnvContent) {
      writeFileSync(envPath, updatedContent);
      console.log(`📝 Updated .env with PostgreSQL port ${availablePorts.postgres}`);
    }
  } catch (error) {
    console.error('⚠️ Warning: Could not update .env file with dynamic port:', error.message);
  }
}

function restoreOriginalEnv() {
  if (originalEnvContent && envPath && existsSync(envPath)) {
    try {
      writeFileSync(envPath, originalEnvContent);
      console.log('✅ Restored original .env file');
    } catch (error) {
      console.error('⚠️ Warning: Could not restore original .env file:', error.message);
    }
  }
}

async function startServices() {
  const cliArgs = parseCliArgs();
  
  if (cliArgs.help) {
    showHelp();
    return;
  }

  console.log('🚀 Starting volo-app development server...\n');

  try {
    // Get available ports
    const availablePorts = await getAvailablePorts();
    
    // Check database configuration for Cloudflare Workers mode
    if (!checkDatabaseConfiguration(cliArgs.useWrangler)) {
      process.exit(1);
    }

    // Update .env file with dynamic PostgreSQL port
    updateEnvWithDynamicPorts(availablePorts, cliArgs.useWrangler);

    // Create temporary firebase.json for consistent port configuration
    await createFirebaseConfig(availablePorts);

    // Build commands
    const commands = cliArgs.useWrangler ? [
      `"firebase emulators:start --only auth --project demo-project --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && wrangler dev --port ${availablePorts.backend} --local-protocol http"`,
      `"cd ui && pnpm run dev -- --port ${availablePorts.frontend} --strictPort --api-url http://localhost:${availablePorts.backend} --open"`
    ] : [
      `"firebase emulators:start --only auth --project demo-project --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && pnpm run dev -- --port ${availablePorts.backend} --postgres-port ${availablePorts.postgres}"`,
      `"cd ui && pnpm run dev -- --port ${availablePorts.frontend} --strictPort --api-url http://localhost:${availablePorts.backend} --open"`
    ];

    // Start loading animation
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerIndex = 0;
    let dotCount = 0;
    
    const spinnerInterval = setInterval(() => {
      const dots = '.'.repeat((dotCount % 4));
      const spaces = ' '.repeat(3 - dots.length);
      
      process.stdout.write(`\r${spinnerChars[spinnerIndex]} Starting services${dots}${spaces}`);
      
      spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
      dotCount++;
    }, 150);

    // Start services with clean output monitoring
    const child = spawn('npx', [
      'concurrently', 
      '-c', 'cyan,magenta,green',  // Colors for the three services
      '-n', 'firebase,server,frontend',  // Names for the services
      '--handle-input',
      '--success', 'first',
      ...commands
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],  // Capture stdout/stderr initially
      shell: true,
      cwd: path.join(__dirname, '..')
    });

    let startupComplete = false;
    let startupTimeout;
    let servicesStarted = new Set();
    let capturedOutput = '';

    // Set a timeout for startup detection
    startupTimeout = setTimeout(() => {
      if (!startupComplete) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
        
        // Show any captured output first
        if (capturedOutput) {
          process.stdout.write(capturedOutput);
        }
        console.log('✅ All services are starting up...\n');
        showServiceInfo(availablePorts, cliArgs.useWrangler);
        startupComplete = true;
        // Switch to live output
        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
      }
    }, 15000); // 15 second fallback - Firebase can be slow

    // Monitor output for service startup indicators
    child.stdout.on('data', (data) => {
      const output = data.toString();
      
      if (!startupComplete) {
        // Capture output during startup
        capturedOutput += output;
        
        // Look for the key startup indicators
        if (output.includes('Auth Emulator') || output.includes('emulator started')) {
          servicesStarted.add('firebase');
        }
        if (output.includes('VITE') && output.includes('ready')) {
          servicesStarted.add('frontend');
        }
        if (output.includes('🚀 Starting Node.js server') || output.includes('API available')) {
          servicesStarted.add('server');
        }

        // Wait specifically for Firebase "All emulators ready!" message
        if (output.includes('All emulators ready!') || output.includes('✔  All emulators ready!')) {
          clearTimeout(startupTimeout);
          if (!startupComplete) {
            // Wait 1 second for Firebase to finish all its output, then show our clean summary
            setTimeout(() => {
              clearInterval(spinnerInterval);
              process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
              
              // Show all the captured startup output first
              process.stdout.write(capturedOutput);
              
              console.log('✅ All services started successfully!\n');
              showServiceInfo(availablePorts, cliArgs.useWrangler);
              startupComplete = true;
              // Switch to live output for ongoing logs
              child.stdout.pipe(process.stdout);
              child.stderr.pipe(process.stderr);
            }, 1000);
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      
      if (!startupComplete) {
        // Check for startup errors
        if (output.includes('Error:') || output.includes('error') || output.includes('failed')) {
          clearTimeout(startupTimeout);
          console.error('❌ Error during startup:');
          console.error(output);
          process.exit(1);
        }
      }
    });

    // Cleanup on exit
    const cleanup = () => {
      // Restore original .env file
      restoreOriginalEnv();
      
      // Clean up temporary firebase.json
      const firebaseConfigPath = path.join(__dirname, '../firebase.json');
      if (existsSync(firebaseConfigPath)) {
        try {
          unlinkSync(firebaseConfigPath);
        } catch (error) {
          // Silent cleanup failure
        }
      }
    };

    ['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach(signal => {
      process.on(signal, () => {
        console.log(`\n🛑 Shutting down services...`);
        cleanup();
        process.exit(0);
      });
    });

    child.on('exit', (code) => {
      cleanup();
      if (code !== 0) {
        console.log(`\n❌ Services stopped with error code ${code}`);
      }
      process.exit(code);
    });

    child.on('error', (error) => {
      handleError(error, 'Error starting services');
    });

  } catch (error) {
    handleError(error);
  }
}

function showServiceInfo(availablePorts, useWrangler) {
  console.log('🎉 Your app is ready at:');
  console.log(`   Frontend:  \x1b[32mhttp://localhost:${availablePorts.frontend}\x1b[0m`);
  console.log(`   Backend:   http://localhost:${availablePorts.backend}`);
  console.log(`   Firebase Emulator UI:  http://localhost:${availablePorts.firebaseUI}`);
  
  // Determine database URL
  let databaseUrl = `postgresql://postgres:password@localhost:${availablePorts.postgres}/postgres`;
  if (useWrangler) {
    // For Cloudflare Workers, try to read the actual DATABASE_URL
    const envPath = path.join(__dirname, '../server/.env');
    if (existsSync(envPath)) {
      try {
        const envContent = readFileSync(envPath, 'utf-8');
        const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
        if (dbUrlMatch) {
          databaseUrl = dbUrlMatch[1];
        }
      } catch (error) {
        // Silent fallback
      }
    }
  }
  
  console.log(`   Database:  ${databaseUrl}`);
  
  if (useWrangler) {
    console.log('\n⚡ Running in Cloudflare Workers mode');
  } else {
    console.log('\n🗄️  Using embedded PostgreSQL database');
  }
  
  console.log('\n📋 Live service logs:\n');
}

startServices().catch((error) => {
  handleError(error);
});