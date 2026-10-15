import type { Me } from './models';

// Kept free of Angular DI so the HTTP interceptor can read it without a circular dependency.
const KEY = 'edge-sdn-auth';

export interface StoredAuth { token: string; me: Me; }

export function readAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function writeAuth(a: StoredAuth): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage unavailable */ }
}

export function clearAuth(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
