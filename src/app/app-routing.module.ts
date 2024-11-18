import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TournamentComponent } from './components/tournament/tournament.component';
import { AboutComponent } from './components/about/about.component';

const routes: Routes = [
    { path: '', component: AboutComponent },
    {
        path: 'tournament', component: TournamentComponent,
        children: [
            {
                path: '**',
                component: TournamentComponent
            }
        ]
    }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }
