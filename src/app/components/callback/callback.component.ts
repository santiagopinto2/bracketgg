import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-callback',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatIconModule, MatButtonModule],
  templateUrl: './callback.component.html',
  styleUrls: ['./callback.component.scss']
})
export class CallbackComponent implements OnInit {
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    const code = this.route.snapshot.queryParamMap.get('code');
    const error = this.route.snapshot.queryParamMap.get('error');

    if (error) {
      this.error.set(error);
      this.loading.set(false);
      return;
    }

    if (!code) {
      this.error.set('No authorization code received');
      this.loading.set(false);
      return;
    }

    try {
      await this.authService.handleOAuthCallback(code);
      const returnUrl = localStorage.getItem('oauth_return_url');
      if (returnUrl) {
        localStorage.removeItem('oauth_return_url');
        this.router.navigateByUrl(returnUrl);
      } else {
        this.router.navigate(['/']);
      }
    } catch (err: any) {
      this.error.set(err.message || 'Authentication failed');
      this.loading.set(false);
    }
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
