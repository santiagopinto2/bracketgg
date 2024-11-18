import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {

    apiFormControl = new FormGroup({
        token: new FormControl('')
    });
    token = this.apiFormControl.get('token');

    constructor() { }

    ngOnInit(): void {
        this.token.setValue(localStorage.getItem('token') ?? '');
    }

    submit() {
        localStorage.setItem('token', this.token.value);
    }
}
