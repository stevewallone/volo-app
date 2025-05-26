import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import * as schema from '../schema/users';

// Detect if this is a Neon database connection
const isNeonDatabase = (connectionString: string): boolean => {
  return connectionString.includes('neon.tech') || connectionString.includes('neon.database');
};

// Create a database connection that works with both Neon and Supabase
const createDbConnection = (connectionString: string) => {
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