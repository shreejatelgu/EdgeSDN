import { expect, test } from '@playwright/test';
import { clearAuth, readAuth, writeAuth } from '../../frontend/src/app/core/auth-store';

/** Minimal in-memory Storage so the browser-only module can run in Node. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

// Newer Node versions may define their own sessionStorage accessor: replace and restore it safely.
const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
function setStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'sessionStorage', { value, configurable: true, writable: true });
}
function restoreStorage(): void {
  if (original) {
    Object.defineProperty(globalThis, 'sessionStorage', original);
  } else {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
}

const auth = { token: 'Basic YWRtaW46YWRtaW4xMjM=', me: { username: 'admin', roles: ['ROLE_ADMIN'] } };

test.describe('auth-store - session persistence of the login', () => {
  let storage: MemoryStorage;
  test.beforeEach(() => { storage = new MemoryStorage(); setStorage(storage); });
  test.afterEach(() => restoreStorage());

  test('nothing stored -> not logged in', () => {
    expect(readAuth()).toBeNull();
  });

  test('write then read returns the same token and identity', () => {
    writeAuth(auth);
    expect(readAuth()).toEqual(auth);
  });

  test('clear logs out', () => {
    writeAuth(auth);
    clearAuth();
    expect(readAuth()).toBeNull();
  });

  test('corrupted storage content is treated as logged out', () => {
    storage.setItem('edge-sdn-auth', '{not json');
    expect(readAuth()).toBeNull();
  });

  test('uses its own key and leaves other session data alone', () => {
    storage.setItem('other', 'keep');
    writeAuth(auth);
    clearAuth();
    expect(storage.getItem('other')).toBe('keep');
  });
});

test.describe('auth-store - storage unavailable (private mode, blocked site data)', () => {
  test.afterEach(() => restoreStorage());

  test('throwing storage: never throws, behaves as logged out', () => {
    setStorage({
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError'); }
    });
    expect(() => writeAuth(auth)).not.toThrow();
    expect(readAuth()).toBeNull();
    expect(() => clearAuth()).not.toThrow();
  });

  test('missing storage: never throws, behaves as logged out', () => {
    setStorage(undefined);
    expect(readAuth()).toBeNull();
    expect(() => writeAuth(auth)).not.toThrow();
    expect(() => clearAuth()).not.toThrow();
  });
});
