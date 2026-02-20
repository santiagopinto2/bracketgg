import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, timer, throwError, retry, switchMap, from } from 'rxjs';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const InterceptorService: HttpInterceptorFn = (req, next) => {
  const maxRetries = 100;
  const delay = 1000;
  const authService = inject(AuthService);

  return next(req).pipe(
    retry({
      count: maxRetries,
      delay: (error, retryCount) => {
        // Handle rate limiting (429)
        if (error.status === 429) {
          return timer(delay);
        }

        // Handle unauthorized (401) - try to refresh token once
        if (error.status === 401 && retryCount === 1) {
          return from(authService.refreshAccessToken()).pipe(
            switchMap(() => timer(0)), // Retry immediately after refresh
            catchError(() => {
              authService.logout(); // Force logout if refresh fails
              return throwError(() => error);
            })
          );
        }

        return throwError(() => error);
      },
    }),
    catchError((error) => {
      if (error.status === 401) {
        console.log('Authentication failed. Please login again.');
      } else {
        console.log('Request failed after retries:', error.error?.message);
      }
      return throwError(() => error);
    })
  );
};