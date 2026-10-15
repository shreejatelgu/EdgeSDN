import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { clearAuth, readAuth, writeAuth } from './auth-store';
import { Me } from './models';
import { basicAuthHeader } from './utils';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<Me | null>(readAuth()?.me ?? null);
  readonly isAdmin = computed(() => this.user()?.roles.includes('ROLE_ADMIN') ?? false);

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<Me> {
    const token = basicAuthHeader(username, password);
    return this.http.get<Me>('/api/auth/me', { headers: { Authorization: token } }).pipe(
      tap(me => {
        writeAuth({ token, me });
        this.user.set(me);
      })
    );
  }

  logout(): void {
    clearAuth();
    this.user.set(null);
  }
}
