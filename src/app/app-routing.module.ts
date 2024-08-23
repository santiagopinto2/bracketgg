import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BracketComponent } from './components/bracket/bracket.component';
import { TournamentComponent } from './components/tournament/tournament.component';

const routes: Routes = [
    { path: 'bracket', component: BracketComponent },
    {
        path: 'tournament', component: TournamentComponent,
        children: [
            {
                path: '**',
                component: TournamentComponent
            }
        ]
    },
    { path: '', redirectTo: '/bracket', pathMatch: 'full' }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }
