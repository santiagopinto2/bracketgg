import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { AppRoutingModule } from './app/app-routing.module';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app/app.component';
import { importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { InterceptorService } from './app/services/interceptor.service';


bootstrapApplication(AppComponent, {
    providers: [
        provideZoneChangeDetection(), importProvidersFrom(BrowserModule, AppRoutingModule),
        provideAnimations(),
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClient(withXhr(), withInterceptors([InterceptorService]))
    ]
})
    .catch(err => console.error(err));
