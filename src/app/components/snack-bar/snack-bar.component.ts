import { Component, Inject } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector: 'app-snack-bar',
    imports: [MatProgressSpinnerModule, MatIconModule, MatButtonModule],
    templateUrl: './snack-bar.component.html',
    styleUrl: './snack-bar.component.scss'
})
export class SnackBarComponent {

    constructor(@Inject(MAT_SNACK_BAR_DATA) public data: any, private snackBarRef: MatSnackBarRef<SnackBarComponent>) { }

    close() {
        this.snackBarRef.dismiss();
    }
}
