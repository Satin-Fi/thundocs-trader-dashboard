// Runtime config: the dashboard now talks to its OWN origin (vercel.app) and
// Vercel proxies /api/* to the backend tunnel (see vercel.json). This keeps the
// browser off the flapping Cloudflare quick-tunnel edge entirely.
window.__API_URL__ = "";
