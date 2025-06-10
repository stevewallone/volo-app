/**
 * Cross-platform environment variable utilities
 * Works with both Node.js (process.env) and Cloudflare Workers (c.env)
 */

type EnvLike = Record<string, string | undefined>;

let contextEnv: EnvLike | null = null;

export function setEnvContext(env: any) {
  contextEnv = env;
}

export function clearEnvContext() {
  contextEnv = null;
}

function getEnvSource(): EnvLike {
  // If contextEnv is set (from middleware), use it
  if (contextEnv) {
    return contextEnv;
  }
  
  // Fallback to process.env (for environments where middleware hasn't run yet)
  if (typeof process !== 'undefined' && process.env) {
    return process.env;
  }
  
  // Last resort - empty object
  return {};
}

/**
 * Get environment variable with fallback support
 * Works in both Node.js and Cloudflare Workers environments
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  const value = getEnvSource()[key];
  return value !== undefined ? value : defaultValue;
}

/**
 * Get required environment variable, throws if missing
 */
export function getRequiredEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    // Include debug info about the environment source
    const envSource = contextEnv ? 'contextEnv' : 'process.env';
    const availableKeys = Object.keys(getEnvSource()).slice(0, 5); // Show first 5 keys for debugging
    throw new Error(`Required environment variable ${key} is not set. Environment source: ${envSource}, Available keys: [${availableKeys.join(', ')}${availableKeys.length < Object.keys(getEnvSource()).length ? '...' : ''}]`);
  }
  return value;
}

/**
 * Check if we're in development mode
 * Works across Node.js and Cloudflare Workers
 */
export function isDevelopment(): boolean {
  return getEnv('NODE_ENV') === 'development' || 
         getEnv('FIREBASE_AUTH_EMULATOR_HOST') !== undefined;
}

/**
 * Get database URL from environment
 */
export function getDatabaseUrl(): string | undefined {
  return getEnv('DATABASE_URL');
}

/**
 * Check if DATABASE_URL points to local embedded postgres
 */
export function isLocalEmbeddedPostgres(): boolean {
  const dbUrl = getDatabaseUrl();
  // Check if it's any localhost PostgreSQL connection (embedded postgres)
  return dbUrl ? (dbUrl.includes('localhost:') && dbUrl.includes('postgres:password')) : false;
}

/**
 * Get Firebase project ID from environment
 */
export function getFirebaseProjectId(): string {
  return getRequiredEnv('FIREBASE_PROJECT_ID');
}

/**
 * For Node.js environments - get process.env
 */
export function getNodeEnv() {
  return process.env;
} 