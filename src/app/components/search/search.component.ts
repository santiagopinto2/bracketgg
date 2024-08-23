import { Component, Output } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
    selector: 'app-search',
    templateUrl: './search.component.html',
    styleUrls: ['./search.component.scss']
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
