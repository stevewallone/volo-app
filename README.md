# Full-Stack Application Template: React, Hono, Firebase, Neon & Cloudflare

This repository provides a highly opinionated, production-ready template for building full-stack applications with a decoupled frontend and backend. It's designed to maximize development velocity while adhering to best practices, including clear separation of concerns and secure handling of sensitive credentials.

Many boilerplates offer a rapid 'hello world' experience for local development but often defer critical decisions about authentication, database integration, and production deployment. This template takes a different approach. We believe that the complexities of a true full-stack application - setting up auth, a database, and distinct hosting for UI and API - are largely unavoidable for production use. By addressing these components comprehensively from the start, this template aims to provide a clearer, more predictable path to a robust, deployable application, minimizing 'surprise' hurdles down the line and fostering a deeper understanding of the full stack architecture.

> **💡 Quick Start:** Use `npx create-volo-app` for automated setup, or follow the manual setup instructions below if using this template directly.

**Core Philosophy:**
*   **Decoupled Architecture:** Separate UI (React/Vite) and API (Hono/Cloudflare Workers) for independent development, scaling, and deployment. This intentionally differs from monolithic frameworks like Next.js to provide greater flexibility and increase clarity.
*   **Rapid Feature Development:** By addressing foundational setup (including auth, DB, and UI basics) upfront, this template allows you to start coding core features faster with a clear path to production. Includes out-of-the-box authentication, UI components, and a clear project structure.
*   **Targeted Deployment:** Optimized for deployment on Cloudflare's ecosystem (Workers for the API, Pages for the UI), leveraging its performance, scalability, and low cost.

## Tech Stack

**Frontend (UI):**
*   **React:** A popular JavaScript library for building user interfaces.
*   **Vite:** A blazing-fast frontend build tool and development server.
*   **TypeScript:** Adds static typing to JavaScript for improved code quality and maintainability.
*   **Tailwind CSS:** A utility-first CSS framework for rapid UI development.
*   **ShadCN/UI:** Beautifully designed, accessible UI components built with Radix UI and Tailwind CSS.
*   **Firebase Authentication:** Handles user authentication (Google Sign-In pre-configured). Free for an unlimited number of users.

**Backend (Server):**
*   **Hono:** A small, simple, and ultrafast web framework for Cloudflare Workers and other edge environments used as our API layer.
*   **Cloudflare Workers:** Serverless execution environment for running your API at the edge, close to users.
*   **TypeScript:** Consistent language across the stack.
*   **Firebase Authentication (Admin):** Verifies user tokens on protected API routes.
*   **PostgreSQL (Neon):** A robust, open-source relational database. Neon.tech is recommended for its serverless Postgres offering, providing a simple connection URL.
*   **Drizzle ORM:** A TypeScript ORM for SQL databases, providing type-safe database access.

**Tooling:**
*   **pnpm:** Fast, disk space-efficient package manager.
*   **Wrangler:** CLI for developing and deploying Cloudflare Workers and running the server locally.

## Quick Start (Recommended)

Use the official CLI for automated setup:

```bash
npx create-volo-app my-app
cd my-app
pnpm dev:start
```

**What the CLI does for you:**
1. **Clones this template** and sets up the project structure
2. **Guides you through service authentication** (Firebase, Neon, Cloudflare)
3. **Creates projects/apps automatically** via service APIs
4. **Generates all configuration files** with real values (no manual editing!)
5. **Runs post-setup automation** (dependencies, database schema, validation)
6. **Ready to code!** - Just run `pnpm dev:start`

## Manual Setup (Alternative)

If you prefer to set up the template manually or need to understand the underlying structure:

### Prerequisites

Before you begin, ensure you have the following installed:
*   **Node.js:** (LTS version recommended, e.g., v18 or v20+)
*   **pnpm:** Install via `npm install -g pnpm` if you haven't already.
*   **Git:** For cloning the repository.

### Manual Setup Process

**1. Clone and Install**
```bash
git clone <TODO: REPLACE THIS WITH ACTUAL REPO URL>
cd <repository-name>
pnpm install
```

**2. Set Up External Services**

You'll need to manually create accounts and projects for:
- **Firebase:** Create project at [console.firebase.google.com](https://console.firebase.google.com)
  - Enable Google Authentication
  - Create a web app and note the configuration values
- **Neon:** Create database at [neon.tech](https://neon.tech)
  - Create a project and note the connection string
- **Cloudflare:** Create account at [cloudflare.com](https://cloudflare.com)
  - Choose a unique name for your Worker

**3. Generate Configuration Files**

Copy the template files and replace placeholders with your actual values:

```bash
# Copy templates to working files
cp server/.dev.vars.example server/.dev.vars
cp ui/src/lib/firebase-config.template.json ui/src/lib/firebase-config.json
```

**4. Edit Configuration Files**

**Edit `server/.dev.vars`** - Replace placeholders with real values:
```ini
DATABASE_URL=postgresql://user:password@your-neon-host/dbname  # From Neon
FIREBASE_PROJECT_ID=your-firebase-project-id                  # From Firebase
```

**Edit `ui/src/lib/firebase-config.json`** - Replace all `{{FIREBASE_*}}` placeholders with your Firebase app configuration values.

**Edit `server/wrangler.toml`** - Replace `{{WORKER_NAME}}` with your chosen Cloudflare Worker name.

**5. Run Post-Setup**

Once your configuration files are ready, run the automated setup:

```bash
pnpm post-setup
```

**What `post-setup` does:**
- ✅ Validates that all required configuration files exist
- 📦 Installs all dependencies
- 🗄️ Deploys database schema to your Neon database
- 🎉 Confirms everything is ready for development

**6. Start Development**
```bash
pnpm dev:start
```

## Development Workflow

Run both frontend and backend simultaneously:

```bash
# Start both servers
pnpm dev:start

# Or run separately:
# Terminal 1: cd server && pnpm dev
# Terminal 2: cd ui && pnpm dev
```

- **Backend API:** `http://localhost:8787`
- **Frontend UI:** `http://localhost:5173`

## Understanding the Setup Process

### Template Files vs Generated Files

This template uses a placeholder system for configuration:

**Template Files (committed to repo):**
- `server/.dev.vars.example` - Contains `{{DATABASE_URL}}`, `{{FIREBASE_PROJECT_ID}}`
- `ui/src/lib/firebase-config.template.json` - Contains `{{FIREBASE_API_KEY}}`, etc.
- `server/wrangler.toml` - Contains `{{WORKER_NAME}}`

**Generated Files (created during setup):**
- `server/.dev.vars` - Real environment variables
- `ui/src/lib/firebase-config.json` - Real Firebase configuration
- These are in `.gitignore` and never committed

### The Post-Setup Script

The `scripts/post-setup.js` script is the final step in both manual and CLI workflows:

**Purpose:** Handle technical setup tasks after configuration files exist
**Used by:** Both CLI (automatically) and manual setup (when you run `pnpm post-setup`)
**What it does:**
1. Validates required files exist
2. Installs dependencies 
3. Deploys database schema
4. Provides success/error feedback

## Deployment

**Backend (Cloudflare Worker):**
```bash
cd server
pnpm run deploy
```
*Note: Cloudflare Workers don't require a separate build step - Wrangler handles the build process automatically during deployment.*

**Frontend (Cloudflare Pages):**
1. Connect your Git repository to Cloudflare Pages
2. Set build command: `pnpm run build`
3. Set build output directory: `ui/dist`
4. Deploy automatically on push

## Project Structure

```
├── README.md                 # This file
├── package.json             # Root workspace configuration
├── pnpm-workspace.yaml      # pnpm workspace setup
├── scripts/                 # Setup and utility scripts
│   └── post-setup.js       # Final setup automation (used by both CLI and manual)
├── server/                  # Backend API (Hono + Cloudflare Workers)
│   ├── wrangler.toml       # Cloudflare Worker config (contains {{WORKER_NAME}} placeholder)
│   ├── .dev.vars.example   # Environment template (contains {{PLACEHOLDERS}})
│   └── src/                # Server source code
│       ├── index.ts        # Main API entry point
│       ├── db/             # Database utilities
│       ├── middleware/     # Custom middleware
│       └── schema/         # Database schema (Drizzle ORM)
└── ui/                     # Frontend React application (Vite)
    ├── vite.config.ts      # Vite configuration
    ├── public/             # Static assets
    └── src/                # Frontend source code
        ├── main.tsx        # React entry point
        ├── App.tsx         # Root component
        ├── components/     # UI components (ShadCN)
        ├── lib/            # Utilities and configuration
        │   └── firebase-config.template.json  # Template (contains {{PLACEHOLDERS}})
        ├── pages/          # Page components
        └── layouts/        # Layout components
```

## Template Usage (For CLI Developers)

This template is designed to work with the `create-volo-app` CLI through a placeholder replacement system:

**Template Placeholders:**
```json
{
  "WORKER_NAME": "string",
  "FIREBASE_PROJECT_ID": "string", 
  "FIREBASE_API_KEY": "string",
  "FIREBASE_MESSAGING_SENDER_ID": "string",
  "FIREBASE_APP_ID": "string", 
  "FIREBASE_MEASUREMENT_ID": "string",
  "DATABASE_URL": "string"
}
```

**CLI Integration:**
1. CLI clones template
2. CLI replaces `{{PLACEHOLDERS}}` with real values
3. CLI calls `pnpm post-setup` to complete technical setup
4. User gets a working app

## Customization and Next Steps

*   **Database Schema:** Modify `server/src/schema/` files and run `pnpm db:push` from server directory
*   **API Routes:** Add new Hono routes in `server/src/index.ts` or separate route files
*   **UI Components:** Build React components in `ui/src/components/` using ShadCN/UI
*   **Styling:** Customize `tailwind.config.js` and use Tailwind utility classes

## Need Help?

- 📖 Check out the detailed documentation in each workspace (`server/README.md`, `ui/README.md`)
- 🐛 Report issues in the GitHub repository
- 💬 Join our community discussions

Happy Coding! 🚀 