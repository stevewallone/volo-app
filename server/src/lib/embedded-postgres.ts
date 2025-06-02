import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let embeddedInstance: EmbeddedPostgres | null = null;
let connectionString: string | null = null;

const isDatabaseInitialized = (dataDir: string): boolean => {
  const pgVersionFile = path.join(dataDir, 'PG_VERSION');
  const postgresqlConfFile = path.join(dataDir, 'postgresql.conf');
  return existsSync(pgVersionFile) && existsSync(postgresqlConfFile);
};

export const startEmbeddedPostgres = async (): Promise<string> => {
  if (embeddedInstance && connectionString) {
    return connectionString;
  }

  console.log('🗄️ Starting embedded PostgreSQL...');

  const dataDir = path.join(__dirname, '../../../data/postgres');
  const isInitialized = isDatabaseInitialized(dataDir);

  embeddedInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
    port: 5433,
    persistent: true,
  });

  if (!isInitialized) {
    console.log('📦 Initializing PostgreSQL cluster...');
    await embeddedInstance.initialise();
  }

  await embeddedInstance.start();
  connectionString = 'postgresql://postgres:password@localhost:5433/postgres';

  console.log('✅ Embedded PostgreSQL started');
  return connectionString;
};

export const stopEmbeddedPostgres = async (): Promise<void> => {
  if (!embeddedInstance) return;

  try {
    console.log('🛑 Stopping embedded PostgreSQL...');
    await embeddedInstance.stop();
    embeddedInstance = null;
    connectionString = null;
    console.log('✅ Embedded PostgreSQL stopped');
  } catch (error) {
    console.error('❌ Error stopping embedded PostgreSQL:', error);
    embeddedInstance = null;
    connectionString = null;
  }
};

export const getEmbeddedConnectionString = (): string | null => connectionString;