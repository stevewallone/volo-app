import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePGlite } from 'drizzle-orm/pglite';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '../schema/users';

// Detect if this is a Neon database connection
const isNeonDatabase = (connectionString: string): boolean => {
  return connectionString.includes('neon.tech') || connectionString.includes('neon.database');
};

// Create a database connection that works with both Neon, Supabase, and local PGlite
const createDbConnection = (connectionString?: string) => {
  // If no connection string provided, use local PGlite for development
  if (!connectionString) {
    console.log('No DATABASE_URL found, using local PGlite database at ./data/local.db');
    const client = new PGlite('./data/local.db');
    return drizzlePGlite(client, { schema });
  }

  if (isNeonDatabase(connectionString)) {
    // Use Neon's HTTP driver for optimal performance in Cloudflare Workers
    const sql = neon(connectionString);
    return drizzle(sql, { schema });
  } else {
    // Use postgres.js for Supabase and other PostgreSQL providers
    // This works well in serverless environments and supports connection pooling
    const client = postgres(connectionString, { 
      prepare: false, // Disable prepared statements for compatibility with connection poolers
      max: 1, // Limit connections in serverless environment
    });
    return drizzlePostgres(client, { schema });
  }
};

export { createDbConnection }; 