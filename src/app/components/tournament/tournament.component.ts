import { Component, OnInit } from '@angular/core';
import { map, mergeMap } from 'rxjs';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss']
})
export class TournamentComponent implements OnInit {

    sets = [];
    winnersIndex = -1;
    maxRound = [0, 0];
    maxRoundModifier = [1, -1];

    constructor(private startggService: StartggService, private tournamentDataService: TournamentDataService) {
    }

    ngOnInit() {
        this.tournamentDataService.currentUrl.subscribe(url => {
            /* this.getBracket(); */
        })

        this.tournamentDataService.currentEvent.subscribe(event => {
            this.getBracket(event);
        })
    }

    getBracket(eventId) {
        if (eventId == -1) return;

        this.startggService.getEventById(eventId).subscribe(data => {
            if (data.errors) { console.log('error', data.errors[0].message); return; }
            if (data.data.event.phases.length == 1) {
                this.getPhase(data.data.event.phases[0].id);
            }
        })
    }

    getPhase(phaseId) {
        this.startggService.getPhaseSets(phaseId).subscribe(data => {
            if (data.errors) { console.log('error', data.errors[0].message); return; }
            this.sets = data.data.phase.sets.nodes;

            if (this.sets[this.sets.length - 1].fullRoundText === 'Grand Final Reset') {
                if (this.sets[this.sets.length - 1].slots[0].entrant) this.sets[this.sets.length - 1].round++;
                else this.sets.pop();
            }

            this.winnersIndex = this.sets.findIndex(set => set.round > 0);
            let losersRoundChange = Math.abs(this.sets[this.winnersIndex - 1].round) - 1;
            for (let i = 0; i < this.winnersIndex; i++) this.sets[i].round += losersRoundChange;

            this.maxRound[0] = this.sets[this.sets.length - 1].round;
            this.maxRound[1] = Math.abs(this.sets[0].round);
        })
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
