import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// A player's picture in a circle, or their initial on their color. A team shows its first two
// players on a diagonal, in the order of its name, like a set card does (`entrant.pictures`, which
// the bracket works out).
@Component({
    selector: 'app-player-avatar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[style.--pa-size]': "size() + 'px'" },
    template: `
        @if (entrant()?.pictures; as pictures) {
        <span class="pa-pair">
            @for (picture of pictures; track $index) {
            <span class="pa-pic">
                @if (picture.url) {
                <img [class.portrait]="picture.portrait" [src]="picture.url" alt="" loading="lazy" draggable="false" />
                } @else {
                <span class="pa-initial" [style.background-color]="picture.color">{{ picture.initial }}</span>
                }
            </span>
            }
        </span>
        } @else {
        <span class="pa-pic">
            @if (image(); as picture) {
            <img [class.portrait]="picture.height > picture.width" [src]="picture.url" alt="" loading="lazy" draggable="false" />
            } @else {
            <span class="pa-initial" [style.background-color]="entrant()?.backgroundColor">{{ initial() }}</span>
            }
        </span>
        }
    `,
    styles: `
        :host {
            position: relative;
            display: inline-block;
            flex: none;
            width: var(--pa-size);
            height: var(--pa-size);
        }

        .pa-pic {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            overflow: hidden;
            background: var(--avatar-bg);
        }

        img {
            position: absolute;
            left: 50%;
            top: 50%;
            height: 100%;
            width: auto;
            transform: translate(-50%, -50%);
        }

        img.portrait {
            width: 100%;
            height: auto;
        }

        .pa-initial {
            display: grid;
            place-items: center;
            width: 100%;
            height: 100%;
            color: var(--avatar-text);
            font-size: calc(var(--pa-size) * 0.5);
            font-weight: 500;
            line-height: 1;
        }

        /* A team: two circles, each 64% of the box, the second in front. The first has a circle cut
           out where the second sits, 1.5px wider than it, so whatever is behind shows between them. */
        .pa-pair .pa-pic {
            inset: auto;
            width: 64%;
            height: 64%;
        }

        .pa-pair .pa-pic:first-child {
            left: 0;
            top: 0;
            -webkit-mask-image: radial-gradient(circle calc(var(--pa-size) * 0.32 + 1.5px) at 106.25% 106.25%, transparent 98%, #000 100%);
            mask-image: radial-gradient(circle calc(var(--pa-size) * 0.32 + 1.5px) at 106.25% 106.25%, transparent 98%, #000 100%);
        }

        .pa-pair .pa-pic:last-child {
            right: 0;
            bottom: 0;
        }

        .pa-pair .pa-initial {
            font-size: calc(var(--pa-size) * 0.34);
        }
    `
})
export class PlayerAvatarComponent {
    entrant = input<any>(null);
    size = input(28);

    // A single player's profile picture, if they have one
    image() {
        return this.entrant()?.participants?.[0]?.user?.images?.[0] ?? null;
    }

    initial() {
        const entrant = this.entrant();
        return ((entrant?.participants?.[0]?.gamerTag || entrant?.name || '?')[0] ?? '?').toUpperCase();
    }
}
