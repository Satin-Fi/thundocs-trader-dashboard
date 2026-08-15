import type { State, Fill } from './types'

// VITE_API_URL is baked into the build via vite.config.ts define (falls back to
// the desktop tunnel). Set VITE_API_URL at Vercel build time to override.
const API_URL: string = (import.meta.env.VITE_API_URL as string || '').replace(/\/$/, '')

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const fetchState = () => get<State>('/api/state')
export const fetchFills = () => get<Fill[]>('/api/fills')
export const apiBase = API_URL
