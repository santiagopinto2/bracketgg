import { Component } from '@angular/core';
import { map, mergeMap } from 'rxjs';
import { StartggService } from 'src/app/services/startgg/startgg.service';

@Component({
    selector: 'app-bracket',
    templateUrl: './bracket.component.html',
    styleUrls: ['./bracket.component.scss']
})
export class BracketComponent {

    sets = [];
    winnersIndex = -1;
    maxRound = [0, 0];
    maxRoundModifier = [1, -1];

    constructor(private startggService: StartggService) {
        //a-la-zeub-3-phryge-la-goat/event/tournoi
        //fighthouse-weeklies-august-13th/event/rw7-78-super-smash-bros-ultimate
        //port-city-smash-heroes-beacon-117-aug-13-2024/event/gg-strive
        //tgz-smashing-tuesdays-141/event/ultimate-singles
        /* this.startggService.getEvent(`tournament/monday-night-melee-424/event/melee-singles`)
            .pipe(
                map(data => {
                    if (data.errors) { console.log('error', data.errors[0].message); return; }
                    return data.data.event.id;
                }),
                mergeMap(id => this.startggService.getSets(id))
            ).subscribe(data => {
                if (data.errors) { console.log('error', data.errors[0].message); return; }
                this.sets = data.data.event.sets.nodes;

                if (this.sets[this.sets.length - 1].fullRoundText === 'Grand Final Reset') {
                    if (this.sets[this.sets.length - 1].slots[0].entrant) this.sets[this.sets.length - 1].round++;
                    else this.sets.pop();
                }

                this.winnersIndex = this.sets.findIndex(set => set.round > 0);
                let losersRoundChange = Math.abs(this.sets[this.winnersIndex - 1].round) - 1;
                for (let i = 0; i < this.winnersIndex; i++) this.sets[i].round += losersRoundChange;

                this.maxRound[0] = this.sets[this.sets.length - 1].round;
                this.maxRound[1] = Math.abs(this.sets[0].round);

                console.log('test1', this.sets)
            }); */
    }

    getRoundSets(round) {
        return this.sets.filter(set => set.round == round);
    }

    isWinner(set, slot) {
        return slot.entrant ? slot.entrant.id == set.winnerId : false;
    }

    getScore(slot, set) {
        if (!slot.standing) return '‎';
        if (slot.standing.stats.score.value) return slot.standing.stats.score.value;

        let otherSlot = set.slots.find(s => s.id != slot.id);
        return otherSlot.standing ? 0 : '‎';
    }
}
