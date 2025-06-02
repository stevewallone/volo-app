import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './api';
import { getEnv, getDatabaseUrl } from './lib/env';
import { startEmbeddedPostgres, stopEmbeddedPostgres } from './lib/embedded-postgres';

const port = parseInt(getEnv('PORT', '8787')!);

const startServer = async () => {
  // Start embedded PostgreSQL if no external database URL is provided
  if (!getDatabaseUrl()) {
    try {
      await startEmbeddedPostgres();
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