import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment.development';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Signals for reactive state
  isAuthenticated = signal<boolean>(false);
  currentUser = signal<any>(null);

  private tokenRefreshTimer: any = null;
  private readonly REFRESH_THRESHOLD_MS = 86400000; // 24 hours before expiry

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.initializeAuthState();
  }

  private initializeAuthState(): void {
    const token = localStorage.getItem('oauth_access_token');
    if (token) {
      if (this.isTokenExpired()) {
        this.refreshAccessToken().catch(() => this.logout());
      } else {
        this.isAuthenticated.set(true);
        this.scheduleTokenRefresh();
      }
    }
  }

  initiateOAuthFlow(): void {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: environment.startgg.clientId,
      scope: environment.startgg.scopes,
      redirect_uri: environment.startgg.redirectUri
    });

    window.location.href = `${environment.startgg.authUrl}?${params.toString()}`;
  }

  redirectToOAuthWithReturn(): void {
    const returnUrl = window.location.pathname + window.location.search + window.location.hash;
    localStorage.setItem('oauth_return_url', returnUrl);
    this.initiateOAuthFlow();
  }

  async handleOAuthCallback(code: string): Promise<void> {
    try {
      // Call our local proxy server instead of start.gg directly (avoids CORS issues)
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(
          'http://localhost:3000/api/auth/token',
          { code },
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      this.storeTokens(response);
      this.isAuthenticated.set(true);
      this.scheduleTokenRefresh();
    } catch (error) {
      console.error('Token exchange failed:', error);
      throw new Error('Failed to complete authentication');
    }
  }

  async refreshAccessToken(): Promise<void> {
    const refreshToken = localStorage.getItem('oauth_refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      // Call our local proxy server instead of start.gg directly (avoids CORS issues)
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(
          'http://localhost:3000/api/auth/refresh',
          { refresh_token: refreshToken },
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      this.storeTokens(response);
      this.scheduleTokenRefresh();
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.logout();
      throw error;
    }
  }

  private storeTokens(response: TokenResponse): void {
    const expiryTime = Date.now() + (response.expires_in * 1000);

    localStorage.setItem('oauth_access_token', response.access_token);
    localStorage.setItem('oauth_refresh_token', response.refresh_token);
    localStorage.setItem('oauth_token_expiry', expiryTime.toString());
    localStorage.setItem('oauth_scopes', environment.startgg.scopes);
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    const expiryTime = this.getTokenExpirationTime();
    const now = Date.now();
    const timeUntilExpiry = expiryTime - now;

    // Refresh at 80% of token lifetime or 24 hours before expiry, whichever comes first
    const refreshTime = Math.min(
      timeUntilExpiry * 0.8,
      timeUntilExpiry - this.REFRESH_THRESHOLD_MS
    );

    if (refreshTime > 0) {
      console.log(`Token refresh scheduled in ${Math.round(refreshTime / 1000 / 60 / 60)} hours`);
      this.tokenRefreshTimer = setTimeout(() => {
        console.log('Triggering scheduled token refresh...');
        this.refreshAccessToken().catch(err => {
          console.error('Scheduled token refresh failed:', err);
        });
      }, refreshTime);
    } else {
      // Token is about to expire or already expired, refresh immediately
      console.log('Token expired or expiring soon, refreshing immediately...');
      this.refreshAccessToken().catch(() => this.logout());
    }
  }

  private isTokenExpired(): boolean {
    const expiryTime = this.getTokenExpirationTime();
    return Date.now() >= expiryTime;
  }

  private getTokenExpirationTime(): number {
    const expiry = localStorage.getItem('oauth_token_expiry');
    return expiry ? parseInt(expiry) : 0;
  }

  getAccessToken(): string | null {
    if (this.isTokenExpired()) {
      return null;
    }
    return localStorage.getItem('oauth_access_token');
  }

  logout(): void {
    localStorage.removeItem('oauth_access_token');
    localStorage.removeItem('oauth_refresh_token');
    localStorage.removeItem('oauth_token_expiry');
    localStorage.removeItem('oauth_scopes');

    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    this.isAuthenticated.set(false);
    this.currentUser.set(null);
    this.router.navigate(['/']);

    console.log('Logged out successfully');
  }
}
