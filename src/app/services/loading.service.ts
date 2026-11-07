import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { SnackBarComponent } from '../components/snack-bar/snack-bar.component';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {

  currentValue = signal<boolean>(false);
  snackBar = inject(MatSnackBar);
  snackBarRef: MatSnackBarRef<SnackBarComponent> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  updateValue(newValue: boolean) {
    this.currentValue.set(newValue);
    this.clearDismissTimer();

    if (newValue) this.open({ isLoading: true });
    else if (this.snackBarRef) {
      this.snackBarRef.instance.data = { isLoading: false };
      this.dismissTimer = setTimeout(() => this.snackBar.dismiss(), 2000);
    }
  }

  // A status line under the spinner while loading, like a rate-limit wait
  notice(message: string) {
    if (this.currentValue() && this.snackBarRef) this.snackBarRef.instance.data = { isLoading: true, message };
  }

  // Ends the loading state with a message that stays up until closed or the next load starts
  error(message: string) {
    this.currentValue.set(false);
    this.clearDismissTimer();
    this.open({ isLoading: false, error: message });
  }

  private open(data: any) {
    const ref = this.snackBar.openFromComponent(SnackBarComponent, { data });
    this.snackBarRef = ref;
    ref.afterDismissed().subscribe(() => {
      if (this.snackBarRef === ref) this.snackBarRef = null;
    });
  }

  private clearDismissTimer() {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
  }
}
