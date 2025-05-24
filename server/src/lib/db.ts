import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from '../schema/users';

// Configure neon to use fetch API available in Cloudflare Workers
neonConfig.fetchConnectionCache = true;

// Create a database connection
const createDbConnection = (connectionString: string) => {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
};

export { createDbConnection }; 