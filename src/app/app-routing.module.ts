import { NgModule } from '@angular/core';
import { RouterModule, Routes, UrlMatcher, UrlSegment } from '@angular/router';
import { EventComponent } from './components/event/event.component';
import { TournamentComponent } from './components/tournament/tournament.component';
import { AboutComponent } from './components/about/about.component';
import { CallbackComponent } from './components/callback/callback.component';

const eventMatcher: UrlMatcher = (segments: UrlSegment[]) => {
    if (segments.length > 0 && segments[0].path === 'tournament' && segments.some(s => s.path === 'event')) {
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
    { matcher: eventMatcher, component: EventComponent },
    { matcher: tournamentMatcher, component: TournamentComponent }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }
