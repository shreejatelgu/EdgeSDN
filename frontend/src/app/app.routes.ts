import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuditComponent } from './pages/audit.component';
import { ControlComponent } from './pages/control.component';
import { DashboardComponent } from './pages/dashboard.component';
import { EnforcementsComponent } from './pages/enforcements.component';
import { EventsComponent } from './pages/events.component';
import { LoginComponent } from './pages/login.component';
import { PolicyComponent } from './pages/policy.component';
import { PredictionsComponent } from './pages/predictions.component';
import { RecommendationDetailComponent } from './pages/recommendation-detail.component';
import { RecommendationsComponent } from './pages/recommendations.component';
import { TelemetryComponent } from './pages/telemetry.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'telemetry', component: TelemetryComponent, canActivate: [authGuard] },
  { path: 'events', component: EventsComponent, canActivate: [authGuard] },
  { path: 'predictions', component: PredictionsComponent, canActivate: [authGuard] },
  { path: 'recommendations', component: RecommendationsComponent, canActivate: [authGuard] },
  { path: 'recommendations/:id', component: RecommendationDetailComponent, canActivate: [authGuard] },
  { path: 'enforcements', component: EnforcementsComponent, canActivate: [authGuard] },
  { path: 'policy', component: PolicyComponent, canActivate: [authGuard] },
  { path: 'audit', component: AuditComponent, canActivate: [authGuard] },
  { path: 'control', component: ControlComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
