import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bake the API base into the build so the deployed dashboard always knows where
// the backend is — without depending on Vercel's .env handling (it ignores
// committed .env.* files). Override at build time with VITE_API_URL if desired.
// When the desktop tunnel restarts, update TUNNEL_URL below and redeploy.
const TUNNEL_URL = 'https://insight-stamp-frames-expiration.trycloudflare.com'
const API_URL = process.env.VITE_API_URL || TUNNEL_URL

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(API_URL),
  },
})
