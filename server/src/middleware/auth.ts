import { MiddlewareHandler } from 'hono';
import { verifyFirebaseToken } from '../lib/firebase-auth';
import { createDbConnection } from '../lib/db';
import { eq } from 'drizzle-orm';
import { users } from '../schema/users';

declare module 'hono' {
  interface ContextVariableMap {
    user: {
      id: string;
      email: string;
      display_name?: string | null;
      photo_url?: string | null;
      created_at: Date;
      updated_at: Date;
    };
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.split('Bearer ')[1];
    const firebaseUser = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID, c.env);

    // Create database connection (now async)
    const db = await createDbConnection(c.env.DATABASE_URL);

    // Check if user exists in database
    const existingUser = await db.select()
      .from(users)
      .where(eq(users.id, firebaseUser.id))
      .limit(1);

    let user = existingUser[0];

    // If user doesn't exist, create them
    if (!user) {
      const newUser = {
        id: firebaseUser.id,
        email: firebaseUser.email!,
        display_name: null,
        photo_url: null,
      };

      const [createdUser] = await db.insert(users)
        .values(newUser)
        .returning();
      
      user = createdUser;
    }

    // Add user to context
    c.set('user', user);
    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Unauthorized' }, 401);
  }
}; 