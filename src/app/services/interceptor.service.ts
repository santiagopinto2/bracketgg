import { HttpInterceptorFn, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from './auth.service';

// The browser never holds a start.gg token: the server adds one to each /api/gql request and refreshes
// it when it expires, then retries with the new one. When start.gg refuses the refresh, the server
// ends the session, answers with the site's token instead and says so in the x-session header.
// Rate limits (429) are retried in StartggService, which pauses every request at once.
export const InterceptorService: HttpInterceptorFn = (req, next) => {
  // Looked up only when needed: AuthService's own first request passes through here while it is being created
  const injector = inject(Injector);
  const ended = (headers: { get(name: string): string | null } | undefined) => headers?.get('x-session') === 'ended';

  return next(req).pipe(
    tap({
      next: event => {
        if (event instanceof HttpResponse && ended(event.headers)) injector.get(AuthService).sessionEnded();
      },
      error: error => {
        if (error instanceof HttpErrorResponse && ended(error.headers)) injector.get(AuthService).sessionEnded();
      },
    })
  );
};
