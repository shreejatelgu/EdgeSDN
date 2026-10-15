import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  styles: [`.box { max-width: 360px; margin: 12vh auto; }`],
  template: `
    <div class="panel box">
      <h1>EDGE-SDN Console</h1>
      <p class="muted small">Autonomous, explainable SDN management (academic prototype)</p>
      @if (error) { <div class="alert error">{{ error }}</div> }
      <form (ngSubmit)="submit()" class="grid">
        <label>Username <input name="u" [(ngModel)]="username" autocomplete="username" required></label>
        <label>Password <input name="p" type="password" [(ngModel)]="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit" [disabled]="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      </form>
    </div>`
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  error = '';
  busy = false;

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.auth.logout();
  }

  submit(): void {
    this.busy = true;
    this.error = '';
    this.auth.login(this.username, this.password).subscribe({
      next: () => { this.busy = false; this.router.navigate(['/']); },
      error: err => {
        this.busy = false;
        this.error = err.status === 401 ? 'Invalid username or password' : errorMessage(err);
      }
    });
  }
}
