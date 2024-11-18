import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { SharedMaterialModule } from './shared-material/shared-material.module';
import { SearchComponent } from './components/search/search.component';
import { TournamentComponent } from './components/tournament/tournament.component';
import { SettingsComponent } from './components/settings/settings.component';
import { AboutComponent } from './components/about/about.component';

@NgModule({
    declarations: [
        AppComponent,
        SearchComponent,
        TournamentComponent,
        SettingsComponent,
        AboutComponent
    ],
    imports: [
        BrowserModule,
        AppRoutingModule,
        BrowserAnimationsModule,
        SharedMaterialModule
    ],
    providers: [],
    bootstrap: [AppComponent]
})
export class AppModule { }
