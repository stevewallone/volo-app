# Runtime Independence Plan for volo-app

## Overview

Transform the volo-app template from being Cloudflare Workers-specific to being **runtime/platform-independent** with **Node.js as the default runtime** while preserving Cloudflare Workers as an advanced deployment option.

## Current State Analysis

### Platform Coupling Assessment
After analyzing the existing volo-app template:

**✅ Low Coupling (Good Foundation)**
- **Web Framework**: Hono is runtime-agnostic (works on Node.js, Deno, Bun, Cloudflare Workers)
- **Database Layer**: Already abstracted with multiple providers (Neon, Supabase, PGlite)
- **Authentication**: Uses Firebase Auth with standard JWT verification
- **Frontend**: Completely platform-agnostic React/Vite app

**🔧 High Coupling (Needs Fixing)**
- **Environment Variable Access**: Uses `c.env.VARIABLE_NAME` pattern specific to Cloudflare Workers
- **Development Scripts**: Hardcoded to use `wrangler dev`
- **Runtime Entry Point**: Structured specifically for Cloudflare Workers export pattern

## Goal

Make the template work seamlessly across multiple runtimes:
- **Default**: Node.js (beginner-friendly, universal)
- **Advanced**: Cloudflare Workers (production edge deployment)
- **Future**: Vercel, Netlify, Railway, etc.

## Implementation Strategy

### Phase 1: Environment Abstraction Layer

#### 1.1 Create Environment Utility
**New File**: `server/src/lib/env.ts`

```typescript
// Support multiple runtime environments
export const getEnvVar = (name: string, context?: any): string | undefined => {
  // Node.js/standard runtime
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  
  // Cloudflare Workers
  if (context?.env && typeof context.env[name] !== 'undefined') {
    return context.env[name];
  }
  
  // Fallback
  return undefined;
};

// Environment detection
export const getRuntimeType = (): 'node' | 'cloudflare' | 'unknown' => {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }
  
  if (typeof caches !== 'undefined' && typeof Request !== 'undefined') {
    return 'cloudflare';
  }
  
  return 'unknown';
};
```

#### 1.2 Update Environment Usage
**Files to Update**: 
- `server/src/middleware/auth.ts`
- Any other files using `c.env.VARIABLE_NAME`

**Current Pattern**:
```typescript
const firebaseUser = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID, c.env);
const db = await createDbConnection(c.env.DATABASE_URL);
```

**New Pattern**:
```typescript
import { getEnvVar } from '../lib/env';

// For middleware, pass context when available
const projectId = getEnvVar('FIREBASE_PROJECT_ID', c);
const dbUrl = getEnvVar('DATABASE_URL', c);

const firebaseUser = await verifyFirebaseToken(token, projectId, c);
const db = await createDbConnection(dbUrl);
```

### Phase 2: Runtime Adapters

#### 2.1 Node.js Adapter
**New File**: `server/src/adapters/node.ts`

```typescript
import { serve } from '@hono/node-server';
import app from '../index';

const port = parseInt(process.env.PORT || '8787');

console.log(`🚀 Starting Node.js server on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
```

#### 2.2 Cloudflare Workers Adapter
**New File**: `server/src/adapters/cloudflare.ts`

```typescript
// Keep existing Cloudflare Workers export pattern
import app from '../index';

export default app;
```

#### 2.3 Update Main Entry Point
**File**: `server/src/index.ts`

**Current**: Exports Hono app directly for Cloudflare Workers
**New**: Keep as runtime-agnostic Hono app

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { createDbConnection } from './lib/db';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Routes (unchanged)
// ... existing routes ...

// Export the app (runtime-agnostic)
export default app;
```

### Phase 3: Development Scripts Update

#### 3.1 Update server/package.json Scripts
**Current**:
```json
{
  "scripts": {
    "dev": "wrangler dev src/index.ts",
    "deploy": "wrangler deploy"
  }
}
```

**New**:
```json
{
  "scripts": {
    "dev": "tsx watch src/adapters/node.ts",
    "dev:node": "tsx watch src/adapters/node.ts", 
    "dev:cf": "wrangler dev src/adapters/cloudflare.ts",
    "deploy": "wrangler deploy",
    "deploy:cf": "wrangler deploy"
  },
  "dependencies": {
    "@hono/node-server": "^1.12.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0"
  }
}
```

#### 3.2 Runtime Detection in Development
**New File**: `server/scripts/detect-runtime.js`

```javascript
// Helper script to detect and suggest appropriate dev command
const runtime = process.argv[2];

const commands = {
  node: 'npm run dev:node',
  cloudflare: 'npm run dev:cf',
  auto: 'npm run dev' // defaults to Node.js
};

console.log(`Detected runtime preference: ${runtime || 'auto'}`);
console.log(`Suggested command: ${commands[runtime] || commands.auto}`);
```

### Phase 4: Configuration Templates

#### 4.1 Multi-Runtime Configuration
**Keep Existing**: `wrangler.toml` for Cloudflare Workers
**Add New**: Node.js configuration options

**New File**: `server/.env.example`
```bash
# Node.js Runtime Configuration
PORT=8787
NODE_ENV=development

# Database
DATABASE_URL=

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_API_KEY=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
FIREBASE_MEASUREMENT_ID=
```

#### 4.2 Platform-Specific Documentation
**New File**: `server/README-RUNTIMES.md`

```markdown
# Runtime Deployment Guide

## Node.js (Default)
```bash
npm run dev          # Start Node.js development server
npm run dev:node     # Explicit Node.js development
```

## Cloudflare Workers
```bash
npm run dev:cf       # Start Cloudflare Workers development
npm run deploy:cf    # Deploy to Cloudflare Workers
```

## Environment Variables
- **Node.js**: Uses `.env` file and `process.env`
- **Cloudflare**: Uses `wrangler.toml` and Workers environment
```

### Phase 5: Template Selection in CLI

#### 5.1 CLI Runtime Flag Support
**File**: `create-volo-app/src/index.ts`

```typescript
// Add runtime selection flag
program
  .option('--runtime <type>', 'Choose runtime (node|cloudflare)', 'node')
  .option('--full', 'Full production setup (implies cloudflare runtime)')
```

#### 5.2 Template Processing
**File**: `create-volo-app/src/commands/create.ts`

```typescript
// Process based on runtime selection
const processTemplate = async (options: CreateOptions) => {
  const runtime = options.full ? 'cloudflare' : (options.runtime || 'node');
  
  if (runtime === 'node') {
    await setupNodejsRuntime(projectPath);
  } else if (runtime === 'cloudflare') {
    await setupCloudflareRuntime(projectPath);
  }
};
```