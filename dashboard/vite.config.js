/**
 * Vite Configuration for Medical Mirror Dashboard
 *
 * Configures the React development server and build process.
 * Dev server runs on port 5173 by default.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API requests to the backend server during development
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
