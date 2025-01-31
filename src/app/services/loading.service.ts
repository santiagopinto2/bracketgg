import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject } from 'rxjs';
import { SnackBarComponent } from '../components/snack-bar/snack-bar.component';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {

  private isLoadingSubject = new BehaviorSubject<boolean>(false);
  currentValue = this.isLoadingSubject.asObservable();
  snackBar = inject(MatSnackBar);
  snackBarRef;

  constructor() { }

  updateValue(newValue: boolean) {
    this.isLoadingSubject.next(newValue);

    if (newValue) this.snackBarRef = this.snackBar.openFromComponent(SnackBarComponent, { data: { isLoading: true } });
    else {
      this.snackBarRef.instance.data = { isLoading: false };
      setTimeout(() => {
        this.snackBar.dismiss();
      }, 2000);
    }
  }
}
