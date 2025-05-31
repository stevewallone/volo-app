import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { createDbConnection } from './lib/db';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check route - public
app.get('/', (c) => c.json({ status: 'ok', message: 'API is running' }));

// API routes
const api = new Hono();

// Public routes go here (if any)
api.get('/hello', (c) => {
  return c.json({
    message: 'Hello from Hono!',
  });
});

// Database test route - public for testing
api.get('/db-test', async (c) => {
  try {
    const db = await createDbConnection();
    
    // Test basic database functionality
    const result = await db.query.users.findMany();
    
    return c.json({
      message: 'Database connection successful!',
      users: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database test error:', error);
    return c.json({
      error: 'Database connection failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Protected routes - require authentication
const protectedRoutes = new Hono();

protectedRoutes.use('*', authMiddleware);

protectedRoutes.get('/me', (c) => {
  const user = c.get('user');
  return c.json({
    user,
    message: 'You are authenticated!',
  });
});

// Mount the protected routes under /protected
api.route('/protected', protectedRoutes);

// Mount the API router
app.route('/api/v1', api);

export default app; 