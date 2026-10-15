import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { clearAuth, readAuth } from './auth-store';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = readAuth();
  const request = auth && !req.headers.has('Authorization')
    ? req.clone({ setHeaders: { Authorization: auth.token } })
    : req;
  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.endsWith('/api/auth/me')) {
        clearAuth();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
