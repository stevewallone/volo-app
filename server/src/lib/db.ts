import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '../schema/users';

// Global PGlite instance for local development
let pg: PGlite | null = null;

// Detect if this is a Neon database connection
const isNeonDatabase = (connectionString: string): boolean => {
  return connectionString.includes('neon.tech') || connectionString.includes('neon.database');
};

// Initialize PGlite for local development (simplified version)
const initializePGlite = async (): Promise<PGlite> => {
  if (!pg) {
    console.log('🗄️ Initializing PGlite (simplified)...');
    
    try {
      // Simple in-memory PGlite instance first
      console.log('📦 Creating basic PGlite instance...');
      pg = new PGlite();
      
      const yo = await pg.query("select 'Hello world' as message;");
      console.log(yo);
    } catch (error) {
      console.error('❌ PGlite initialization failed:', error);
      pg = null;
      throw error;
    }
  }
  
  return pg;
};

// Create a database connection that works with Neon, Supabase, and local PGlite
const createDbConnection = async (connectionString?: string) => {
  // If no connection string provided, use local PGlite
  if (!connectionString) {
    console.log('🔧 Using local PGlite database');
    
    try {
      const pgliteInstance = await initializePGlite();
      return drizzlePglite(pgliteInstance, { schema });
    } catch (error) {
      console.error('❌ Failed to create PGlite connection:', error);
      throw error;
    }
  }

  const dbUrl = connectionString;

  if (isNeonDatabase(dbUrl)) {
    // Use Neon's HTTP driver for optimal performance in Cloudflare Workers
    const sql = neon(dbUrl);
    return drizzle(sql, { schema });
  } else {
    // Use postgres.js for Supabase, local PGlite server, and other PostgreSQL providers
    const client = postgres(dbUrl, { 
      prepare: false, // Disable prepared statements for compatibility with connection poolers
      max: 1, // Limit connections in serverless environment
    });
    return drizzlePostgres(client, { schema });
  }
};

export { createDbConnection }; 