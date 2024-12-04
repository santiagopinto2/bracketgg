import { Component } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

@Component({
    selector: 'app-search',
    templateUrl: './search.component.html',
    styleUrls: ['./search.component.scss'],
    imports: [FormsModule, ReactiveFormsModule, MatFormField, MatLabel, MatInput]
})
export class SearchComponent {

    eventFormControl = new FormGroup({
        url: new FormControl('')
    });
    url = this.eventFormControl.get('url');

    constructor(private router: Router) { }

    submit() {
        this.router.navigate(['/tournament' + this.url.value.slice(this.url.value.indexOf('tournament') + 10)]);
    }
}
