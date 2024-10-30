import { AfterViewInit, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';
import { SetOrderConstants } from './set-order-constants';

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
    bracketSideHeight = 700;

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
        round = Math.trunc(round);
        return phaseGroup ? phaseGroup.sets.nodes.filter(set => set.round == round).sort((a, b) => a.id - b.id) : [];
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

    getColumnWidth(column) {
        return column % 3 == 0 ? '204px' : '22px';
    }

    getSetMargin(phaseGroup, round, set) {
        let setHeight = 42;
        let sets = this.getRoundSets(phaseGroup, round);
        let setCount = sets.length;
        let rightRoundSets = this.getRoundSets(phaseGroup, (round + Math.sign(round)));
        let rightRoundSetCount = rightRoundSets.length;


        if (setCount == rightRoundSetCount || setCount / 2 == rightRoundSetCount || rightRoundSetCount == 0) {
            let marginHeight = (this.bracketSideHeight - setCount * setHeight) / (setCount * 2);
            return `${marginHeight}px 0`;
        }
        if (round < 0) {
            let players = [];
            phaseGroup.sets.nodes.forEach(s => {
                players.push(s.slots[0].entrant.id);
                players.push(s.slots[1].entrant.id);
            });
            let numberOfPlayers = Array.from(new Set(players)).length;

            if (Math.log(numberOfPlayers) / Math.log(2) % 1 < 0.321928094) {
                let addedSetIndexes = Array(rightRoundSetCount).fill(false);
                for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount}`][i]] = true;

                let roundFirstSetId = sets[0].id;
                let setIndexFull = (set.id - roundFirstSetId) / 2;

                let nextSetIndexFull = addedSetIndexes.indexOf(true, setIndexFull + 1);
                if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount;

                let marginTop = (this.bracketSideHeight - rightRoundSetCount * setHeight) / (rightRoundSetCount * 2);
                let marginBottom = marginTop + (setHeight + marginTop * 2) * (nextSetIndexFull - setIndexFull - 1);
                return `${marginTop}px 0 ${marginBottom}px`;
            }
            else if (Math.log(numberOfPlayers) / Math.log(2) % 1 < 0.584962500) {
                let addedSetIndexes = Array(rightRoundSetCount * 2).fill(false);
                for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount * 2}`][i]] = true;

                let roundFirstSetId = sets[0].id;
                let setIndexFull = set.id - roundFirstSetId;

                let nextSetIndexFull = addedSetIndexes.indexOf(true, setIndexFull + 1);
                if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount * 2;

                if (setIndexFull + 1 == nextSetIndexFull) {
                    let marginHeight = (this.bracketSideHeight - rightRoundSetCount * 2 * setHeight) / (rightRoundSetCount * 2 * 2);
                    return `${marginHeight}px 0`;
                }
                if (setIndexFull + 2 == nextSetIndexFull) {
                    let marginHeight = (this.bracketSideHeight - rightRoundSetCount * 2 * setHeight) / (rightRoundSetCount * 2) + setHeight / 2;
                    return `${marginHeight}px 0`;
                }
            }
            else {
                let addedSetIndexes = Array(rightRoundSetCount).fill(false);
                for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount}`][rightRoundSetCount - 1 - i]] = true;
                let setIndex = sets.findIndex(s => s.id == set.id)

                let roundLastSetId = sets[sets.length - 1].id;
                let setIndexFull = -1;
                let count = 0;
                for (let i = 0; i < addedSetIndexes.length; i++) {
                    if (addedSetIndexes[i]) {
                        count++;
                        if (count == setIndex + 1) {
                            setIndexFull = i;
                            break;
                        }
                    }
                }

                let nextSetIndexFull = addedSetIndexes.indexOf(true, setIndexFull + 1);
                if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount;

                let marginTop = (this.bracketSideHeight - rightRoundSetCount * setHeight) / (rightRoundSetCount * 2);
                if (setIndex == 0) marginTop = marginTop + (setHeight + marginTop * 2) * (setIndexFull);
                let marginBottom = marginTop + (setHeight + marginTop * 2) * (nextSetIndexFull - setIndexFull - 1);
                
                return `${marginTop}px 0 ${marginBottom}px`;
            }
            return '0';
        }
        if (setCount <= rightRoundSetCount) {
            let addedSetIndexes = Array(rightRoundSetCount).fill(false);
            for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount}`][i]] = true;

            let roundFirstSetId = sets[0].id;
            let setIndexFull = (set.id - roundFirstSetId) / 2;

            let nextSetIndexFull = addedSetIndexes.indexOf(true, setIndexFull + 1);
            if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount;

            let marginTop = (this.bracketSideHeight - rightRoundSetCount * setHeight) / (rightRoundSetCount * 2);
            let marginBottom = marginTop + (setHeight + marginTop * 2) * (nextSetIndexFull - setIndexFull - 1);
            return `${marginTop}px 0 ${marginBottom}px`;
        }
        if (setCount > rightRoundSetCount) {
            let addedSetIndexes = Array(rightRoundSetCount * 2).fill(false);
            for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount * 2}`][i]] = true;

            let roundFirstSetId = sets[0].id;
            let setIndexFull = set.id - roundFirstSetId;

            let nextSetIndexFull = addedSetIndexes.indexOf(true, setIndexFull + 1);
            if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount * 2;

            if (setIndexFull + 1 == nextSetIndexFull) {
                let marginHeight = (this.bracketSideHeight - rightRoundSetCount * 2 * setHeight) / (rightRoundSetCount * 2 * 2);
                return `${marginHeight}px 0`;
            }
            if (setIndexFull + 2 == nextSetIndexFull) {
                let marginHeight = (this.bracketSideHeight - rightRoundSetCount * 2 * setHeight) / (rightRoundSetCount * 2) + setHeight / 2;
                return `${marginHeight}px 0`;
            }
        }
        return '0';
    }

    getBlockClass(columnIndex, blockIndex, phaseGroup, bracketSide) {
        let blockColumnIndex = columnIndex % 3;

        let leftRoundSets = this.getRoundSets(phaseGroup, (columnIndex / 3 + 1) * this.maxRoundModifier[bracketSide]);
        let leftRoundSetCount = leftRoundSets.length;
        let rightRoundSetCount = this.getRoundSets(phaseGroup, (columnIndex / 3 + 2) * this.maxRoundModifier[bracketSide]).length;

        let players = [];
        phaseGroup.sets.nodes.forEach(s => {
            players.push(s.slots[0].entrant.id);
            players.push(s.slots[1].entrant.id);
        });
        let numberOfPlayers = Array.from(new Set(players)).length;

        if (leftRoundSetCount / 2 == rightRoundSetCount) {
            if (blockColumnIndex == 1) {
                if (blockIndex % 4 == 1) return 'first-block-column-first-row';
                else if (blockIndex % 4 == 2) return 'first-block-column-second-row';
            }
            else if (blockColumnIndex == 2) {
                if (blockIndex % 4 == 1) return 'straight-block';
            }
        }
        else if (leftRoundSetCount == rightRoundSetCount) {
            if (blockIndex % 4 == 1) return 'straight-block';
        }
        else if (bracketSide == 1 && Math.log(numberOfPlayers) / Math.log(2) % 1 > 0.584962500) {
            let setIndexFull = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][rightRoundSetCount - 1 - i] == setIndexFull && blockIndex % 4 == 1) return 'straight-block';
            }
        }
        else if (leftRoundSetCount < rightRoundSetCount) {
            let setIndexFull = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][i] == setIndexFull && blockIndex % 4 == 1) return 'straight-block';
            }
        }
        else if (leftRoundSetCount > rightRoundSetCount) {
            let addedSetIndexes = Array(rightRoundSetCount * 2).fill(false);
            for (let i = 0; i < leftRoundSetCount; i++) addedSetIndexes[SetOrderConstants[`sets${rightRoundSetCount * 2}`][i]] = true;

            let leftSetIndexFull = Math.trunc(blockIndex / 2);
            let nextSetIndexFull = addedSetIndexes.indexOf(true, leftSetIndexFull + 1);
            if (nextSetIndexFull == -1) nextSetIndexFull = rightRoundSetCount * 2;

            if (leftSetIndexFull + 1 == nextSetIndexFull && addedSetIndexes[leftSetIndexFull]) {
                if (blockColumnIndex == 1) {
                    if (blockIndex % 4 == 1) return 'first-block-column-first-row';
                    else if (blockIndex % 4 == 2) return 'first-block-column-second-row';
                }
                else if (blockColumnIndex == 2) {
                    if (blockIndex % 4 == 1) return 'straight-block';
                }
            }
            if (leftSetIndexFull + 2 == nextSetIndexFull) {
                if (blockIndex % 4 == 1) return 'straight-block';
            }
        }
        return '';
    }
}
