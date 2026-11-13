import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

// Logging in with start.gg is optional: visitors who aren't logged in see everything through the
// site's own token. The start.gg tokens never reach the browser. The server (server/auth.js) keeps
// them and refreshes them, and the browser only holds an HttpOnly session cookie.
//
// Used by the rest of the app: isAuthenticated (a signal), login(), logout().
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  isAuthenticated = signal<boolean>(false);
  // The light or dark theme the server keeps with this login, if the visitor ever chose one (ThemeService)
  savedTheme = signal<string | null>(null);

  // Other tabs of the site hear about a login or logout at once
  private channel: BroadcastChannel | null = typeof BroadcastChannel === 'function' ? new BroadcastChannel('bracketgg-auth') : null;

  constructor(private http: HttpClient) {
    this.channel?.addEventListener('message', event => {
      if (event.data === 'login' || event.data === 'logout') this.checkSession();
    });
    this.checkSession();
  }

  // Asks the server whether this browser's session is logged in. The server refreshes an expired
  // start.gg token first, so this stays true after a week away as long as start.gg accepts the refresh.
  async checkSession(): Promise<boolean> {
    try {
      const res = await firstValueFrom(this.http.get<{ loggedIn: boolean, theme?: string }>('/api/auth/session'));
      this.savedTheme.set(res?.loggedIn ? res.theme ?? null : null);
      this.isAuthenticated.set(!!res?.loggedIn);
    } catch {
      // The server is unreachable: keep what we knew
    }
    return this.isAuthenticated();
  }

  // Sends the visitor to start.gg to log in, then back to this page. `state` is a random value that
  // must come back unchanged, so a callback this browser didn't start is refused (login CSRF).
  login(): void {
    const state = randomState();
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_return_url', window.location.pathname + window.location.search + window.location.hash);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: environment.startgg.clientId,
      scope: environment.startgg.scopes,
      redirect_uri: environment.startgg.redirectUri,
      state,
    });
    window.location.href = `${environment.startgg.authUrl}?${params.toString()}`;
  }

  // The old name of login()
  initiateOAuthFlow(): void {
    this.login();
  }

  // Finishes a login on /callback. Returns the page to go back to.
  async handleOAuthCallback(code: string, state: string | null): Promise<string> {
    const expected = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');
    const returnUrl = sessionStorage.getItem('oauth_return_url');
    sessionStorage.removeItem('oauth_return_url');
    if (!expected || !state || state !== expected)
      throw new Error('This login link was not started from this browser. Log in again from the site.');

    try {
      await firstValueFrom(this.http.post('/api/auth/token', { code }));
    } catch (error) {
      console.error('Token exchange failed:', error);
      throw new Error('start.gg did not accept the login. Try logging in again.');
    }
    this.isAuthenticated.set(true);
    this.channel?.postMessage('login');
    // Only a path on this site, never another site
    return returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.startsWith('/callback') ? returnUrl : '/';
  }

  // The server ended the session (start.gg refused the refresh token): show the visitor as logged out
  sessionEnded(): void {
    if (!this.isAuthenticated()) return;
    this.isAuthenticated.set(false);
    this.channel?.postMessage('logout');
  }

  // Logs out and stays on the page, which keeps working without a login
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch (error) {
      console.error('Logout failed:', error);
    }
    this.isAuthenticated.set(false);
    this.channel?.postMessage('logout');
  }
}

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
