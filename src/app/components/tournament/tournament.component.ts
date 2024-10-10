import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss']
})
export class TournamentComponent implements OnInit {

    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    winnersIndex = -1;
    maxRounds = [];
    maxRoundModifier = [1, -1];

    constructor(private startggService: StartggService, private tournamentDataService: TournamentDataService, private router: Router) {
    }

    ngOnInit() {
        this.tournamentDataService.currentUrl.subscribe(url => {
            /* this.getBracket(); */
        })

        this.tournamentDataService.currentEvent.subscribe(event => {
            this.phaseGroups = [];
            if (!!event.phaseId) {
                this.getPhasesGeneral(event);
                this.getPhase(event.phaseId);
            }
        })
    }

    getPhasesGeneral(event) {this.startggService.getEventById(event.eventId).subscribe(data => {
            if (data.errors) { console.log('error', data.errors[0].message); return; }
            this.phases = data.data.event.phases;
            
            for (let i = 0; i < this.phases.length; i++) {
                if (this.phases[i].id == event.phaseId) {
                    this.currentPhaseIndex = i;
                    break;
                }
            }
        })
    }

    getPhase(phaseId) {
        this.startggService.getPhase(phaseId).subscribe(data => {
            if (data.errors) { console.log('error', data.errors[0].message); return; }

            for (let i = 0; i < data.data.phase.phaseGroups.nodes.length; i++) {
                this.phaseGroups.push();
                this.getPhaseGroup(data.data.phase.phaseGroups.nodes[i].id, i);
            }
        })
    }

    getPhaseGroup(phaseGroupId, phaseGroupIndex) {
        this.startggService.getPhaseGroup(phaseGroupId).subscribe(data => {
            let phaseGroup = data.data.phaseGroup;
            if (phaseGroup.sets.nodes[phaseGroup.sets.nodes.length - 1].fullRoundText === 'Grand Final Reset') {
                if (phaseGroup.sets.nodes[phaseGroup.sets.nodes.length - 1].slots[0].entrant) phaseGroup.sets.nodes[phaseGroup.sets.nodes.length - 1].round++;
                else phaseGroup.sets.nodes.pop();
            }

            this.winnersIndex = phaseGroup.sets.nodes.findIndex(set => set.round > 0);
            let losersRoundChange = Math.abs(phaseGroup.sets.nodes[this.winnersIndex - 1].round) - 1;
            for (let i = 0; i < this.winnersIndex; i++) phaseGroup.sets.nodes[i].round += losersRoundChange;

            let winnersMaxRound = phaseGroup.sets.nodes[phaseGroup.sets.nodes.length - 1].round;
            let losersMaxRound = Math.abs(phaseGroup.sets.nodes[0].round);
            this.maxRounds.push([winnersMaxRound, losersMaxRound]);

            this.phaseGroups[phaseGroupIndex] = phaseGroup;
        })
    }

    changePhase(direction) {
        this.router.navigate([this.router.url.slice(0, this.router.url.indexOf('/brackets') + '/brackets'.length) + '/' + this.phases[this.currentPhaseIndex + direction].id]);
    }

    getRoundSets(phaseGroup, round) {
        return phaseGroup ? phaseGroup.sets.nodes.filter(set => set.round == round) : [];
    }

    isWinner(set, slot, typeOfDisplay) {
        if (!slot.entrant) return '';
        return slot.entrant.id == set.winnerId ? `winner-${typeOfDisplay}` : `loser-${typeOfDisplay}`;
    }

    getPhaseGroupIdentifier(phaseGroup) {
        return phaseGroup ? phaseGroup.displayIdentifier : '';
    }

    getScore(slot, set) {
        if (!slot.standing) return '‎';
        if (slot.standing.stats.score.value) {
            //if (slot.standing.stats.score.value == -1) return 'DQ';
            return slot.standing.stats.score.value;
        }

        let otherSlot = set.slots.find(s => s.id != slot.id);
        return otherSlot.standing ? 0 : '‎';
    }
}
