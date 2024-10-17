import { AfterViewInit, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss']
})
export class TournamentComponent implements OnInit, AfterViewInit {

    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    winnersIndex = -1;
    maxRounds = [];
    maxRoundModifier = [1, -1];
    isGrabbing = false;

    constructor(private startggService: StartggService, private tournamentDataService: TournamentDataService, private router: Router) {
    }

    ngOnInit() {
        this.tournamentDataService.currentUrl.subscribe(url => {
            /* this.getBracket(); */
        })

        this.tournamentDataService.currentEvent.subscribe(event => {
            // Clear all data
            this.phases = [];
            this.phaseGroups = [];
            this.maxRounds = [];

            // Get all phase and phase group data
            if (!!event.phaseId) {
                this.getPhasesGeneral(event);
                this.getPhase(event.phaseId);
            }
        })
    }

    ngAfterViewInit() {
        // Horizontal drag

        let mouseDown = false;
        let startX, scrollLeft;
        const slider = document.querySelector<HTMLElement>('.mat-sidenav-content');

        const startDragging = event => {
            this.isGrabbing = true;
            mouseDown = true;
            startX = event.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        }

        const stopDragging = event => {
            this.isGrabbing = false;
            mouseDown = false;
        }

        const move = event => {
            event.preventDefault();
            if (!mouseDown) return;
            const x = event.pageX - slider.offsetLeft;
            const scroll = x - startX;
            slider.scrollLeft = scrollLeft - scroll;
        }

        slider.addEventListener('mousemove', move, false);
        slider.addEventListener('mousedown', startDragging, false);
        slider.addEventListener('mouseup', stopDragging, false);
        slider.addEventListener('mouseleave', stopDragging, false);
    }

    getPhasesGeneral(event) {
        this.startggService.getEventById(event.eventId).subscribe(data => {
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

            // Get all phase groups within the phase
            for (let i = 0; i < data.data.phase.phaseGroups.nodes.length; i++) {
                this.phaseGroups.push();
                this.maxRounds.push([]);
                this.getPhaseGroup(data.data.phase.phaseGroups.nodes[i].id, i);
            }
        })
    }

    getPhaseGroup(phaseGroupId, phaseGroupIndex) {
        this.startggService.getPhaseGroup(phaseGroupId).subscribe(data => {
            if (data.errors) { console.log('error', data.errors[0].message); return; }
            
            let phaseGroup = data.data.phaseGroup;
            let phaseGroupSets = phaseGroup.sets.nodes;

            // Corrects the data to account for a grand final reset
            if (phaseGroupSets[phaseGroupSets.length - 1].fullRoundText === 'Grand Final Reset') {
                if (phaseGroupSets[phaseGroupSets.length - 1].slots[0].entrant) phaseGroupSets[phaseGroupSets.length - 1].round++;
                else phaseGroupSets.pop();
            }

            // Standardizes the round data for each set
            this.winnersIndex = phaseGroupSets.findIndex(set => set.round > 0);
            let losersRoundChange = Math.abs(phaseGroupSets[this.winnersIndex - 1].round) - 1;
            if (losersRoundChange != 0) {
                for (let i = 0; i < this.winnersIndex; i++) phaseGroupSets[i].round += losersRoundChange;
            }

            // Stores the max round number for each side of bracket
            let winnersMaxRound = phaseGroupSets[phaseGroupSets.length - 1].round;
            let losersMaxRound = Math.abs(phaseGroupSets[0].round);
            this.maxRounds[phaseGroupIndex] = [winnersMaxRound, losersMaxRound];

            this.phaseGroups[phaseGroupIndex] = phaseGroup;
        })
    }

    changePhase(direction) {
        let url = this.router.url;
        if (url.indexOf('/brackets') == -1) url += '/brackets';
        this.router.navigate([url.slice(0, url.indexOf('/brackets') + '/brackets'.length) + '/' + this.phases[this.currentPhaseIndex + direction].id]);
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
