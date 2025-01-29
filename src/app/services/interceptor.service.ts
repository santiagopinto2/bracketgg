import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, timer, throwError, retry } from 'rxjs';

export const InterceptorService: HttpInterceptorFn = (req, next) => {
  const maxRetries = 100;
  const delay = 1000;
  return next(req).pipe(
    retry({
      count: maxRetries,
      delay: (error) => {
        // Only retry if error is rate limit
        if (error.status == 429) return timer(delay);

        return throwError(() => error);
      },
    }),
    catchError((error) => {
      console.log('Request failed after retries:', error.error.message);
      return throwError(() => error);
    })
  );
};