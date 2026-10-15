import { Component } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  styles: [`
    .shell { display: flex; min-height: 100vh; }
    nav { width: 210px; background: var(--nav); color: #cdd6e0; padding: 16px 0; flex-shrink: 0; }
    nav .brand { font-weight: 700; font-size: 18px; color: #fff; padding: 0 16px 4px; }
    nav .sub { font-size: 11px; padding: 0 16px 16px; color: #8b99a8; }
    nav a { display: block; padding: 8px 16px; color: #cdd6e0; }
    nav a:hover { background: #22303f; text-decoration: none; }
    nav a.active { background: #1f6feb; color: #fff; }
    nav .user { padding: 16px; font-size: 12px; border-top: 1px solid #22303f; margin-top: 16px; }
    main { flex: 1; padding: 20px; min-width: 0; }
  `],
  template: `
    @if (auth.user(); as u) {
      <div class="shell">
        <nav>
          <div class="brand">EDGE-SDN</div>
          <div class="sub">Event-aware, twin-gated SDN management</div>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Dashboard</a>
          <a routerLink="/recommendations" routerLinkActive="active">Recommendations</a>
          <a routerLink="/enforcements" routerLinkActive="active">Enforcements</a>
          <a routerLink="/predictions" routerLinkActive="active">Predictions</a>
          <a routerLink="/telemetry" routerLinkActive="active">Telemetry</a>
          <a routerLink="/events" routerLinkActive="active">Institutional events</a>
          <a routerLink="/policy" routerLinkActive="active">Policy</a>
          <a routerLink="/audit" routerLinkActive="active">Audit log</a>
          <a routerLink="/control" routerLinkActive="active">Network &amp; demo</a>
          <div class="user">
            {{ u.username }} ({{ auth.isAdmin() ? 'admin' : 'viewer' }})<br>
            <a href="" (click)="logout($event)" style="padding: 4px 0">Log out</a>
          </div>
        </nav>
        <main><router-outlet /></main>
      </div>
    } @else {
      <router-outlet />
    }`
})
export class AppComponent {
  constructor(public auth: AuthService, private router: Router) {}

  logout(ev: Event): void {
    ev.preventDefault();
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
