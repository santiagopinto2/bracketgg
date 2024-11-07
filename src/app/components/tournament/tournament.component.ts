import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';
import { SetOrderConstants } from './set-order-constants';
import { Subject } from 'rxjs/internal/Subject';
import { takeUntil } from 'rxjs/operators';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss']
})
export class TournamentComponent implements OnInit, AfterViewInit, OnDestroy {

    destroy$ = new Subject();
    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    maxRounds = [];
    maxRoundModifier = [1, -1];
    isGrabbing = false;
    setHeight = 42;

    constructor(private startggService: StartggService, private tournamentDataService: TournamentDataService, private router: Router) {
    }

    ngOnInit() {
        this.tournamentDataService.eventSource$
            .pipe(takeUntil(this.destroy$))
            .subscribe(event => {
                // Clear all data
                this.phases = [];
                this.currentPhaseIndex = -1;
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

    ngOnDestroy() {
        this.destroy$.next(null);
    }

    getPhasesGeneral(event) {
        this.startggService.getEventById(event.eventId)
            .pipe(takeUntil(this.destroy$))
            .subscribe(data => {
                if (data.errors) { console.log('error', data.errors[0].message); return; }

                this.phases = data.data.event.phases;

                for (let i = 0; i < this.phases.length; i++) {
                    if (this.phases[i].id == event.phaseId) {
                        this.currentPhaseIndex = i;
                        break;
                    }
                }
            });
    }

    getPhase(phaseId) {
        this.startggService.getPhase(phaseId)
            .pipe(takeUntil(this.destroy$))
            .subscribe(data => {
                if (data.errors) { console.log('error', data.errors[0].message); return; }

                // Get all phase groups within the phase
                for (let i = 0; i < data.data.phase.phaseGroups.nodes.length; i++) {
                    this.phaseGroups.push();
                    this.maxRounds.push([]);
                    this.getPhaseGroup(data.data.phase.phaseGroups.nodes[i].id, i);
                }
            });
    }

    getPhaseGroup(phaseGroupId, phaseGroupIndex) {
        this.startggService.getPhaseGroup(phaseGroupId)
            .pipe(takeUntil(this.destroy$))
            .subscribe(data => {
                if (data.errors) { console.log('error', data.errors[0].message); return; }

                let phaseGroup = data.data.phaseGroup;
                let phaseGroupSets = phaseGroup.sets.nodes;

                // Corrects the data to account for a grand final reset
                if (phaseGroupSets[phaseGroupSets.length - 1].fullRoundText === 'Grand Final Reset') {
                    if (phaseGroupSets[phaseGroupSets.length - 1].slots[0].entrant) phaseGroupSets[phaseGroupSets.length - 1].round++;
                    else phaseGroupSets.pop();
                }

                // Standardizes the round data for each set
                let winnersIndex = phaseGroupSets.findIndex(set => set.round > 0);
                let losersRoundChange = Math.abs(phaseGroupSets[winnersIndex - 1].round) - 1;
                if (losersRoundChange != 0) {
                    for (let i = 0; i < winnersIndex; i++) phaseGroupSets[i].round += losersRoundChange;
                }

                // Sorts the round data
                phaseGroupSets.sort((a, b) => a.round != b.round ? a.round - b.round : a.id - b.id);

                // Stores the max round number for each side of bracket
                let winnersMaxRound = phaseGroupSets[phaseGroupSets.length - 1].round;
                let losersMaxRound = Math.abs(phaseGroupSets[0].round);
                this.maxRounds[phaseGroupIndex] = [winnersMaxRound, losersMaxRound];

                // Convert set data into arrays
                phaseGroup.sets.nodes = [[], []];
                for (let i = 0; i < winnersMaxRound; i++) phaseGroup.sets.nodes[0].push(Array.from(phaseGroupSets.filter(set => set.round == i + 1)));
                for (let i = 0; i < losersMaxRound; i++) phaseGroup.sets.nodes[1].push(Array.from(phaseGroupSets.filter(set => set.round == (i + 1) * -1)));

                this.phaseGroups[phaseGroupIndex] = phaseGroup;
            });
    }

    getRoundSets(phaseGroup, round) {
        if (!phaseGroup) return [];
        round = Math.trunc(round);

        if (Math.sign(round) == 1) return phaseGroup.sets.nodes[0][round - 1];
        return phaseGroup.sets.nodes[1][Math.abs(round) - 1];
    }

    getSetMargin(phaseGroup, round, side, set) {
        let sets = this.getRoundSets(phaseGroup, round);
        let setCount = sets.length;
        let rightRoundSets = this.getRoundSets(phaseGroup, (round + Math.sign(round)));
        let rightRoundSetCount = rightRoundSets ? rightRoundSets.length : 0;
        let firstSetId = sets[0].id;


        // If the round set count is a standard amount
        if (setCount == rightRoundSetCount || setCount / 2 == rightRoundSetCount || rightRoundSetCount == 0) {
            let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCount);
            return `${marginHeight}px 0`;
        }

        // If it's loser's side
        if (round < 0) {
            // Get the total number of players in the phase group
            let numberOfPlayers = this.getNumberOfPlayers(phaseGroup);
            let powerOfPlayersRemainder = Math.log(numberOfPlayers) / Math.log(2) % 1;

            // If winner's round 1 set count is less than 1/4 of the way between powers of 2
            if (powerOfPlayersRemainder < 0.321928094) {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = (set.id - firstSetId) / 2;
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
                return `${marginTop}px 0 ${marginBottom}px`;
            }
            // If winner's round 1 set count is between 1/4 and 1/2 of the way between powers of 2
            else if (powerOfPlayersRemainder < 0.584962500) {
                let setCountFull = rightRoundSetCount * 2;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = set.id - firstSetId;
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                if (setIndex + 1 == nextSetIndex) {
                    let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                    return `${marginHeight}px 0`;
                }
                if (setIndex + 2 == nextSetIndex) {
                    let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull) * 2 + this.setHeight / 2;
                    return `${marginHeight}px 0`;
                }
            }
            // If winner's round 1 set count is greater than 1/2 of the way between powers of 2
            else {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, false);

                let setIndexRelative = sets.findIndex(s => s.id == set.id)
                let setIndex = -1;
                let count = 0;
                for (let i = 0; i < addedSetIndexes.length; i++) {
                    if (addedSetIndexes[i]) {
                        count++;
                        if (count == setIndexRelative + 1) {
                            setIndex = i;
                            break;
                        }
                    }
                }
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                let marginTop = setIndexRelative == 0 ? marginHeight + (this.setHeight + marginHeight * 2) * setIndex : marginHeight;
                let marginBottom = marginHeight + (this.setHeight + marginHeight * 2) * (nextSetIndex - setIndex - 1);

                return `${marginTop}px 0 ${marginBottom}px`;
            }

            return '0';
        }

        // If it's winner's side and the round set count is less than or equal to the next round set count
        if (setCount <= rightRoundSetCount) {
            let setCountFull = rightRoundSetCount;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = (set.id - firstSetId) / 2;
            let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

            let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
            let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
            return `${marginTop}px 0 ${marginBottom}px`;
        }

        // If it's winner's side and the round set count is greater than the next round set count
        if (setCount > rightRoundSetCount) {
            let setCountFull = rightRoundSetCount * 2;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = set.id - firstSetId;
            let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

            if (setIndex + 1 == nextSetIndex) {
                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                return `${marginHeight}px 0`;
            }
            if (setIndex + 2 == nextSetIndex) {
                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull) * 2 + this.setHeight / 2;
                return `${marginHeight}px 0`;
            }
        }

        return '0';
    }

    getBlockClass(columnIndex, blockIndex, phaseGroup, bracketSide) {
        let blockColumnIndex = columnIndex % 3;
        let numberOfPlayers = this.getNumberOfPlayers(phaseGroup);
        let leftRoundSetCount = this.getRoundSets(phaseGroup, (columnIndex / 3 + 1) * this.maxRoundModifier[bracketSide]).length;
        let rightRoundSetCount = this.getRoundSets(phaseGroup, (columnIndex / 3 + 2) * this.maxRoundModifier[bracketSide]).length;

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

        // If it's loser's side and winner's round 1 set count is greater than 1/2 of the way between powers of 2
        else if (bracketSide == 1 && Math.log(numberOfPlayers) / Math.log(2) % 1 > 0.584962500) {
            let setIndex = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][rightRoundSetCount - 1 - i] == setIndex && blockIndex % 4 == 1) return 'straight-block';
            }
        }

        else if (leftRoundSetCount < rightRoundSetCount) {
            let setIndex = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][i] == setIndex && blockIndex % 4 == 1) return 'straight-block';
            }
        }

        else if (leftRoundSetCount > rightRoundSetCount) {
            let leftRoundSetCountFull = rightRoundSetCount * 2;
            let addedSetIndexes = this.getAddedSetIndexes(leftRoundSetCountFull, leftRoundSetCount, true);

            let leftSetIndex = Math.trunc(blockIndex / 2);
            let leftNextSetIndex = this.getNextSetIndex(addedSetIndexes, leftSetIndex, leftRoundSetCountFull);

            if (leftSetIndex + 1 == leftNextSetIndex && addedSetIndexes[leftSetIndex]) {
                if (blockColumnIndex == 1) {
                    if (blockIndex % 4 == 1) return 'first-block-column-first-row';
                    else if (blockIndex % 4 == 2) return 'first-block-column-second-row';
                }
                else if (blockColumnIndex == 2) {
                    if (blockIndex % 4 == 1) return 'straight-block';
                }
            }
            if (leftSetIndex + 2 == leftNextSetIndex) {
                if (blockIndex % 4 == 1) return 'straight-block';
            }
        }

        return '';
    }

    getNumberOfPlayers(phaseGroup) {
        let players = [];
        phaseGroup.sets.nodes.forEach(side => {
            side.forEach(round => {
                round.forEach(set => {
                    players.push(set.slots[0].entrant.id);
                    players.push(set.slots[1].entrant.id);
                });
            });
        });
        return Array.from(new Set(players)).length;
    }

    getAddedSetIndexes(length, setCount, isForwards) {
        let addedSetIndexes = Array(length).fill(false);

        if (isForwards) for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${length}`][i]] = true;
        else for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${length}`][length - 1 - i]] = true;

        return addedSetIndexes;
    }

    getNextSetIndex(addedSetIndexes, setIndex, setCountFull) {
        let nextSetIndex = addedSetIndexes.indexOf(true, setIndex + 1);
        return nextSetIndex == -1 ? setCountFull : nextSetIndex;
    }

    getStandardMarginHeight(phaseGroup, side, setCountFull) {
        return (this.getPhaseGroupSideHeight(phaseGroup, side) - setCountFull * this.setHeight) / (setCountFull * 2);
    }

    changePhase(direction) {
        let url = this.router.url;
        if (url.indexOf('/brackets') == -1) url += '/brackets';
        this.router.navigate([url.slice(0, url.indexOf('/brackets') + '/brackets'.length) + '/' + this.phases[this.currentPhaseIndex + direction].id]);
    }

    getPhaseGroupSideHeight(phaseGroup, side) {
        let multiplier = 91;
        if (side == 0) return Math.max(this.getRoundSets(phaseGroup, 1).length, this.getRoundSets(phaseGroup, 2).length) * multiplier;
        return Math.max(this.getRoundSets(phaseGroup, -1).length, this.getRoundSets(phaseGroup, -2).length) * multiplier;
    }

    isWinner(set, slot, typeOfDisplay) {
        if (!slot.entrant) return '';
        return slot.entrant.id == set.winnerId ? `winner-${typeOfDisplay}` : `loser-${typeOfDisplay}`;
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
}
