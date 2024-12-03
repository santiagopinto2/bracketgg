import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    imports: [MatDialogTitle, CdkScrollable, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatDialogActions, MatButton, MatDialogClose]
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
