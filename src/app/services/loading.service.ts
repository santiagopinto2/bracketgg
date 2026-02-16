import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SnackBarComponent } from '../components/snack-bar/snack-bar.component';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {

  currentValue = signal<boolean>(false);
  snackBar = inject(MatSnackBar);
  snackBarRef;

  constructor() { }

  updateValue(newValue: boolean) {
    this.currentValue.set(newValue);

    if (newValue) this.snackBarRef = this.snackBar.openFromComponent(SnackBarComponent, { data: { isLoading: true } });
    else {
      this.snackBarRef.instance.data = { isLoading: false };
      setTimeout(() => {
        this.snackBar.dismiss();
      }, 2000);
    }
  }
}
