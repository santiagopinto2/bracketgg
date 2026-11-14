import { NgModule } from '@angular/core';
import { RouterModule, Routes, UrlMatcher, UrlSegment } from '@angular/router';
import { EventComponent } from './components/event/event.component';
import { EventOverviewComponent } from './components/event-overview/event-overview.component';
import { TournamentComponent } from './components/tournament/tournament.component';
import { AboutComponent } from './components/about/about.component';
import { CallbackComponent } from './components/callback/callback.component';
import { PrivacyComponent } from './components/privacy/privacy.component';
import { AttendeesComponent } from './components/attendees/attendees.component';

// An event URL with /brackets after the event's name opens a bracket; any other event URL opens the
// event's landing page. `path` has no query string.
export function isBracketPath(path: string): boolean {
    const parts = path.split('/').filter(part => part.length > 0);
    return parts.slice(parts.indexOf('event') + 2).includes('brackets');
}

const isEventUrl = (segments: UrlSegment[]) => segments.length > 0 && segments[0].path === 'tournament' && segments.some(s => s.path === 'event');

const eventMatcher: UrlMatcher = (segments: UrlSegment[]) => {
    if (isEventUrl(segments) && isBracketPath(segments.map(s => s.path).join('/'))) {
        return { consumed: segments };
    }
    return null;
};

const eventOverviewMatcher: UrlMatcher = (segments: UrlSegment[]) => {
    if (isEventUrl(segments) && !isBracketPath(segments.map(s => s.path).join('/'))) {
        return { consumed: segments };
    }
    return null;
};

// /tournament/<slug>/attendees
const attendeesMatcher: UrlMatcher = (segments: UrlSegment[]) => {
    if (segments.length === 3 && segments[0].path === 'tournament' && segments[2].path === 'attendees') {
        return { consumed: segments };
    }
    return null;
};

const tournamentMatcher: UrlMatcher = (segments: UrlSegment[]) => {
    if (segments.length > 0 && segments[0].path === 'tournament' && !segments.some(s => s.path === 'event')) {
        return { consumed: segments };
    }
    return null;
};

const routes: Routes = [
    { path: '', component: AboutComponent },
    { path: 'callback', component: CallbackComponent },
    { path: 'privacy', component: PrivacyComponent },
    { matcher: eventMatcher, component: EventComponent },
    { matcher: eventOverviewMatcher, component: EventOverviewComponent },
    { matcher: attendeesMatcher, component: AttendeesComponent },
    { matcher: tournamentMatcher, component: TournamentComponent }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }
