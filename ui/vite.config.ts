import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Parse CLI arguments for dynamic configuration
const parseCliArgs = () => {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const apiUrlIndex = args.indexOf('--api-url');
  
  return {
    port: portIndex !== -1 ? parseInt(args[portIndex + 1]) : 5173,
    apiUrl: apiUrlIndex !== -1 ? args[apiUrlIndex + 1] : 'http://localhost:8787'
  };
};

const { port, apiUrl } = parseCliArgs();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: port
  },
  define: {
    'import.meta.env.VITE_API_URL': `"${apiUrl}"`
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  }
})
