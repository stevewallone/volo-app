import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './api';
import { getEnv, getDatabaseUrl, isLocalEmbeddedPostgres } from './lib/env';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from './lib/embedded-postgres';

// Parse CLI arguments
const parseCliArgs = () => {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const postgresPortIndex = args.indexOf('--postgres-port');
  
  return {
    port: portIndex !== -1 ? parseInt(args[portIndex + 1]) : parseInt(getEnv('PORT', '8787')!),
    postgresPort: postgresPortIndex !== -1 ? parseInt(args[postgresPortIndex + 1]) : 5433
  };
};

const { port, postgresPort } = parseCliArgs();

const startServer = async () => {
  // Start embedded PostgreSQL if no external database URL is provided OR if DATABASE_URL points to local embedded postgres
  if (!getDatabaseUrl() || isLocalEmbeddedPostgres()) {
    try {
      await startEmbeddedPostgres(postgresPort);
    } catch (error) {
      console.error('❌ Failed to start embedded PostgreSQL:', error);
      process.exit(1);
    }
  }

  console.log(`🚀 Starting Node.js server on port ${port}`);
  console.log(`📡 API available at http://localhost:${port}`);
  console.log(`🔥 Health check: http://localhost:${port}/`);

  serve({
    fetch: app.fetch,
    port,
  });
};

// Graceful shutdown
const shutdown = async () => {
  console.log('🛑 Shutting down server...');
  await stopEmbeddedPostgres();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer(); 