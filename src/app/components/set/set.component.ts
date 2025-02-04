import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgFor, NgIf, NgStyle, NgClass } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-set',
    templateUrl: './set.component.html',
    styleUrl: './set.component.scss',
    imports: [CdkScrollable, FormsModule, ReactiveFormsModule, NgFor, NgIf, NgStyle, NgClass, MatButtonModule, MatCardModule, MatDialogModule, MatIconModule]
})
export class SetComponent implements OnInit {

    data = inject(MAT_DIALOG_DATA);
    set;

    constructor() { }

    ngOnInit(): void {
        this.set = this.data.set;
    }

    getCharIcon(game, playerIndex) {
        return game.selections[playerIndex].character.images.find(image => image.type === 'stockIcon').url;
    }

    getEntrantImage(entrant) {
        let profile = this.getEntrantProfile(entrant);
        return profile ? profile.url : '';
    }

    getEntrantImageOrientation(entrant) {
        let profile = this.getEntrantProfile(entrant);
        return profile && profile.height > profile.width ? 'portrait' : '';
    }

    getEntrantProfile(entrant) {
        if (!entrant) return null;
        let images = entrant.participants[0].user.images;
        return images.length > 0 ? images.find(image => image.type === 'profile') : null;
    }

    getWinnerArrow(game = null) {
        if (!this.set.winnerId) return '';
        if (!game) return this.set.slots[0].entrant.id == this.set.winnerId ? 'arrow_left' : 'arrow_right';
        return this.set.slots[0].entrant.id == game.winnerId ? 'arrow_left' : 'arrow_right';
    }

    getResultColor(game, playerIndex) {
        return this.set.slots[playerIndex].entrant.id == game.winnerId ? '#00a800' : '#ff2020';
    }

    getResultAbbr(game, playerIndex) {
        return this.set.slots[playerIndex].entrant.id == game.winnerId ? 'W' : 'L';
    }
}
