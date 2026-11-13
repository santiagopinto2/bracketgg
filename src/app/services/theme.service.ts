import { Injectable, effect, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export type Theme = 'dark' | 'light';

// The same key as the script in src/index.html, which applies the choice before the first paint
const STORAGE_KEY = 'bgg-theme';

const asTheme = (value: unknown): Theme | null => value === 'light' || value === 'dark' ? value : null;

// The dark or light theme. The theme is the data-theme attribute on <html>: src/styles/_tokens.scss and
// _material.scss hang every color on it. Dark is the default whatever the device prefers. A visitor's
// choice is kept in this browser (localStorage) and, for a logged-in visitor, with their login on the
// server too, which gives it back if the browser forgot it.
@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    readonly theme = signal<Theme>(asTheme(document.documentElement.getAttribute('data-theme')) ?? 'dark');

    constructor(private http: HttpClient, private auth: AuthService) {
        // Another tab of the site changed the theme
        window.addEventListener('storage', event => {
            if (event.key === STORAGE_KEY) this.apply(asTheme(event.newValue) ?? 'dark');
        });

        // Logged in: this browser's choice goes to the server, or the server's comes here if this browser has none
        effect(() => {
            if (!this.auth.isAuthenticated()) return;
            const saved = asTheme(this.auth.savedTheme());
            untracked(() => {
                const chosen = this.chosen();
                if (chosen) {
                    if (chosen !== saved) this.saveToServer(chosen);
                } else if (saved) {
                    this.remember(saved);
                    this.apply(saved);
                }
            });
        });
    }

    toggle(): void {
        this.set(this.theme() === 'dark' ? 'light' : 'dark');
    }

    set(theme: Theme): void {
        this.apply(theme);
        this.remember(theme);
        if (this.auth.isAuthenticated()) this.saveToServer(theme);
    }

    private apply(theme: Theme): void {
        document.documentElement.setAttribute('data-theme', theme);
        this.theme.set(theme);
    }

    // What this visitor picked in this browser, or null if they never did
    private chosen(): Theme | null {
        try {
            return asTheme(localStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    private remember(theme: Theme): void {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // Storage is off (some private windows): the theme lasts until the page closes
        }
    }

    private async saveToServer(theme: Theme): Promise<void> {
        try {
            await firstValueFrom(this.http.post('/api/auth/theme', { theme }));
            this.auth.savedTheme.set(theme);
        } catch {
            // Not saved this time: the next change or visit sends it again
        }
    }
}
