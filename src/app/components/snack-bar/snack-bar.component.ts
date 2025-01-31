import { Component, Inject } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_SNACK_BAR_DATA } from '@angular/material/snack-bar';
import { NgIf } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-snack-bar',
  imports: [MatProgressSpinnerModule, NgIf, MatIconModule],
  templateUrl: './snack-bar.component.html',
  styleUrl: './snack-bar.component.scss'
})
export class SnackBarComponent {
  
  constructor(@Inject(MAT_SNACK_BAR_DATA) public data: any) {}
}
