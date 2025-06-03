#!/usr/bin/env node
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAvailablePorts,
  createFirebaseConfig,
  updateServerEnvWithPorts,
  restoreEnvFile,
  cleanupFirebaseConfig,
  checkDatabaseConfiguration,
  getDatabaseUrl
} from './port-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function showServiceInfo(availablePorts, useWrangler) {
  console.log('🎉 Your app is ready at:');
  console.log(`   Frontend:  \x1b[32mhttp://localhost:${availablePorts.frontend}\x1b[0m`);
  console.log(`   Backend:   http://localhost:${availablePorts.backend}`);
  console.log(`   Firebase Emulator UI:  http://localhost:${availablePorts.firebaseUI}`);
  console.log(`   Database:  ${getDatabaseUrl(availablePorts, useWrangler)}`);
  
  if (useWrangler) {
    console.log('\n⚡ Running in Cloudflare Workers mode');
  } else {
    console.log('\n🗄️  Using embedded PostgreSQL database');
  }
  
  console.log('\n📋 Live service logs:\n');
}

async function startServices() {
  const cliArgs = parseCliArgs();
  
  if (cliArgs.help) {
    showHelp();
    return;
  }

  console.log('🚀 Starting volo-app development server...\n');

  // Store cleanup state
  let envState = null;
  let firebaseConfigPath = null;

  try {
    // Get available ports
    const availablePorts = await getAvailablePorts();
    
    // Check database configuration for Cloudflare Workers mode
    if (!checkDatabaseConfiguration(cliArgs.useWrangler)) {
      process.exit(1);
    }

    // Update .env files with dynamic ports
    envState = updateServerEnvWithPorts(availablePorts, cliArgs.useWrangler);

    // Create temporary firebase.json for consistent port configuration
    firebaseConfigPath = createFirebaseConfig(availablePorts);

    // Build commands
    const commands = cliArgs.useWrangler ? [
      `"firebase emulators:start --only auth --project demo-project --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && wrangler dev --port ${availablePorts.backend} --local-protocol http"`,
      `"cd ui && pnpm run dev -- --port ${availablePorts.frontend} --strictPort --api-url http://localhost:${availablePorts.backend} --firebase-auth-port ${availablePorts.firebaseAuth}"`
    ] : [
      `"firebase emulators:start --only auth --project demo-project --export-on-exit=./data/firebase-emulator --import=./data/firebase-emulator"`,
      `"cd server && pnpm run dev -- --port ${availablePorts.backend} --postgres-port ${availablePorts.postgres}"`,
      `"cd ui && pnpm run dev -- --port ${availablePorts.frontend} --strictPort --api-url http://localhost:${availablePorts.backend} --firebase-auth-port ${availablePorts.firebaseAuth}"`
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

    // Cleanup function
    const cleanup = () => {
      restoreEnvFile(envState);
      cleanupFirebaseConfig(firebaseConfigPath);
    };

    // Cleanup on exit
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

startServices().catch((error) => {
  handleError(error);
});