import { ChangeDetectionStrategy, Component } from '@angular/core';

// What the site does with a visitor's data. Keep it in step with the login and the server's cache.
@Component({
    selector: 'app-privacy',
    templateUrl: './privacy.component.html',
    styleUrls: ['./privacy.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PrivacyComponent {
    lastUpdated = 'November 12, 2026';
}
