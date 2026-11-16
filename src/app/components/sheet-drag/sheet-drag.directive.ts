import { Directive, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

// A finger has to move this far (px) before it is a drag and not a tap
const SLOP = 6;
// Released past this part of the sheet's height, the sheet closes
const CLOSE_PART = 0.25;
// A flick closes it too: this fast (px per ms) over the last 100 ms, and at least this far (px)
const FLICK_SPEED = 0.5, FLICK_DISTANCE = 30;
// How long the sheet takes to slide away or back (ms)
const SLIDE = 200;

// Drag to dismiss for a dialog that is a sheet from the bottom of a phone's screen. The set dialog and
// the attendee dialog take it as a host directive.
//
// The dialog is a sheet where its panel (the .cdk-overlay-pane) has `--sheet-drag: 1`, which
// src/styles.scss sets for the phone layouts. Anywhere else this does nothing.
//
// A downward drag moves the sheet with the finger when it starts on a `data-sheet-handle` element, or
// anywhere while everything under the finger is scrolled to its top. Released past a quarter of the
// sheet's height, or flicked down, the sheet slides off the screen and the dialog closes; otherwise it
// slides back. Any other drag scrolls the sheet's content as usual, and one that has nothing to scroll
// does nothing, so the page behind never moves and Safari doesn't pull to refresh.
@Directive({ selector: '[appSheetDrag]' })
export class SheetDragDirective implements OnDestroy {

    private host: HTMLElement = inject(ElementRef).nativeElement;
    private dialogRef = inject(MatDialogRef, { optional: true });
    private zone = inject(NgZone);

    private pane: HTMLElement | null = null;
    // undecided: the finger hasn't moved far enough to tell. drag: the sheet follows the finger.
    // scroll: the browser scrolls the content. hold: nothing may move.
    private mode: 'idle' | 'undecided' | 'drag' | 'scroll' | 'hold' = 'idle';
    private target: Element | null = null;
    private startX = 0;
    private startY = 0;
    private canDrag = false;
    private offset = 0;
    private samples: { t: number, y: number }[] = [];
    private closing = false;
    private timer: any = null;

    constructor() {
        this.zone.runOutsideAngular(() => {
            this.host.addEventListener('touchstart', this.start, { passive: true });
            // Not passive: preventDefault is what keeps the browser from scrolling during a drag
            this.host.addEventListener('touchmove', this.move, { passive: false });
            this.host.addEventListener('touchend', this.end);
            this.host.addEventListener('touchcancel', this.end);
            document.addEventListener('touchmove', this.outside, { passive: false });
        });
    }

    ngOnDestroy() {
        this.host.removeEventListener('touchstart', this.start);
        this.host.removeEventListener('touchmove', this.move);
        this.host.removeEventListener('touchend', this.end);
        this.host.removeEventListener('touchcancel', this.end);
        document.removeEventListener('touchmove', this.outside);
        clearTimeout(this.timer);
    }

    // The dialog's panel, when it is a sheet
    private sheet(): HTMLElement | null {
        const pane = this.host.closest<HTMLElement>('.cdk-overlay-pane');
        return pane && getComputedStyle(pane).getPropertyValue('--sheet-drag').trim() === '1' ? pane : null;
    }

    // The scrolling elements from the finger up to the panel
    private scrollers(): HTMLElement[] {
        const found: HTMLElement[] = [];
        for (let el = this.target as HTMLElement | null; el && this.pane?.contains(el); el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) found.push(el);
        }
        return found;
    }

    private start = (event: TouchEvent) => {
        if (this.closing) return;
        // A second finger (a pinch) ends a drag
        if (this.mode === 'drag') this.settle(false);
        this.mode = 'idle';
        this.pane = this.sheet();
        if (!this.pane || event.touches.length !== 1) return;
        this.target = event.target as Element;
        this.startX = event.touches[0].clientX;
        this.startY = event.touches[0].clientY;
        this.canDrag = !!this.target.closest?.('[data-sheet-handle]') || this.scrollers().every(el => el.scrollTop <= 0);
        this.samples = [];
        this.offset = 0;
        this.mode = 'undecided';
    };

    private move = (event: TouchEvent) => {
        if (this.mode === 'idle' || this.mode === 'scroll' || !this.pane) return;
        const touch = event.touches[0];
        const dx = touch.clientX - this.startX, dy = touch.clientY - this.startY;
        if (this.mode === 'undecided') {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
                // Too short to be a drag yet. Safari can't be stopped once it starts to scroll, so a
                // move that may become a drag is held back already.
                if (this.canDrag && dy > 0 && event.cancelable) event.preventDefault();
                return;
            }
            const vertical = Math.abs(dy) > Math.abs(dx);
            if (vertical && dy > 0 && this.canDrag) {
                this.mode = 'drag';
                clearTimeout(this.timer);
                this.pane.style.transition = 'none';
            } else if (vertical && !this.scrollers().some(el => dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) {
                // Nothing in the sheet scrolls that way, and the page behind must not
                this.mode = 'hold';
            } else {
                this.mode = 'scroll';
                return;
            }
        }
        if (event.cancelable) event.preventDefault();
        if (this.mode !== 'drag') return;
        this.offset = Math.max(0, dy);
        this.pane.style.transform = `translate3d(0, ${this.offset}px, 0)`;
        this.samples.push({ t: event.timeStamp, y: touch.clientY });
        if (this.samples.length > 20) this.samples.shift();
    };

    private end = (event: TouchEvent) => {
        const mode = this.mode;
        this.mode = 'idle';
        if (mode !== 'drag' || !this.pane) return;
        // The finger's speed over the last 100 ms: none when it stopped before letting go
        const recent = this.samples.filter(sample => event.timeStamp - sample.t <= 100);
        const speed = recent.length ? (recent[recent.length - 1].y - recent[0].y) / Math.max(event.timeStamp - recent[0].t, 1) : 0;
        const far = this.offset > this.pane.getBoundingClientRect().height * CLOSE_PART;
        const flicked = speed > FLICK_SPEED && this.offset > FLICK_DISTANCE;
        this.settle(event.type === 'touchend' && (far || flicked));
    };

    // Slides the sheet off the screen and closes the dialog, or slides it back to where it was
    private settle(close: boolean) {
        const pane = this.pane;
        if (!pane) return;
        close = close && !!this.dialogRef;
        this.closing = close;
        const done = () => {
            if (close) {
                this.zone.run(() => this.dialogRef.close());
            } else {
                pane.style.transition = '';
                pane.style.transform = '';
            }
        };
        clearTimeout(this.timer);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || (!close && this.offset === 0)) {
            done();
            return;
        }
        pane.style.transition = `transform ${SLIDE}ms ${close ? 'ease-in' : 'ease-out'}`;
        pane.style.transform = close ? 'translate3d(0, 100%, 0)' : 'translate3d(0, 0, 0)';
        this.timer = setTimeout(done, SLIDE + 20);
    }

    // A drag that starts outside the sheet (on the dimmed page) moves nothing
    private outside = (event: TouchEvent) => {
        if (!event.cancelable || event.touches.length !== 1) return;
        const pane = this.sheet();
        if (pane && !pane.contains(event.target as Node)) event.preventDefault();
    };
}
