import type { State, Fill } from './types'

// In production Vite bakes VITE_API_URL from .env.production (the desktop
// tunnel). If unset, fall back to the live tunnel so the deployed dashboard
// still works. Set VITE_API_URL to a stable server URL to override.
const FALLBACK_API = 'https://mixed-days-robertson-whereas.trycloudflare.com'
const ENV_API: string = (import.meta.env.VITE_API_URL as string) || ''
const API_URL: string = (ENV_API || FALLBACK_API).replace(/\/$/, '')

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const fetchState = () => get<State>('/api/state')
export const fetchFills = () => get<Fill[]>('/api/fills')
export const apiBase = API_URL
