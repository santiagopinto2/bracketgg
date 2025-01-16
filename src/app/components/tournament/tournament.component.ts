import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData/tournamentData.service';
import { SetOrderConstants } from './set-order-constants';
import { Subject } from 'rxjs/internal/Subject';
import { map, startWith, take, takeUntil } from 'rxjs/operators';
import { NgIf, NgFor, NgStyle, NgClass, AsyncPipe } from '@angular/common';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatAutocompleteModule, MatOption } from '@angular/material/autocomplete';
import { MatInput } from '@angular/material/input';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss'],
    imports: [NgIf, MatIconButton, MatIcon, NgFor, NgStyle, NgClass, MatFormField, MatLabel, MatAutocompleteModule, MatInput, FormsModule, ReactiveFormsModule, MatOption, AsyncPipe]
})
export class TournamentComponent implements OnInit, AfterViewInit, OnDestroy {

    destroy$ = new Subject();
    eventId = -1;
    entrants = [];
    entrantCtrl = new FormControl('');
    filteredEntrants: Observable<any>;
    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    maxRounds = [];
    maxRoundModifier = [1, -1];
    maxRoundsPhase = -1;
    isGrabbing = false;
    // setHeight should be a multiple of 4 plus 0.67
    setHeight = 52.67;

    constructor(private startggService: StartggService, private tournamentDataService: TournamentDataService, private router: Router) {
        // Start filtering the search entrants form
        this.filteredEntrants = this.entrantCtrl.valueChanges.pipe(
            startWith(''),
            map(entrant => (entrant ? this._filterEntrants(entrant) : this.entrants.slice())),
        );
    }

    ngOnInit() {
        this.tournamentDataService.eventSource$
            .pipe(takeUntil(this.destroy$))
            .subscribe(event => {
                // Clear data
                this.phases = [];
                this.currentPhaseIndex = -1;
                this.phaseGroups = [];
                this.maxRounds = [];
                this.maxRoundsPhase = -1;

                // Clear this data only if there is no event
                if (!event.phaseId) {
                    this.eventId = -1;
                    this.entrants = [];
                }
                else {
                    // Get entrants only if the event changes
                    if (event.event.id != this.eventId) {
                        this.eventId = event.event.id;

                        this.entrants = event.event.entrants.nodes;
                        this.entrants.forEach(entrant => {
                            if (!entrant.participants[0].user) entrant.participants[0].user = { images: [] };

                            if (this.getEntrantImage(entrant) === '') {
                                const hue = Math.floor(Math.random() * 361);
                                const sat = Math.floor(Math.random() * 101);
                                const lum = 40;
                                entrant.backgroundColor = `hsl(${hue}, ${sat}%, ${lum}%)`;
                            }

                            entrant.seed = entrant.seeds.reduce((earliest, current) => earliest.phase.id < current.phase.id ? earliest : current).seedNum;
                            delete entrant.seeds;
                        });

                        this.entrantCtrl.setValue('');
                    }

                    // Get all phase and phase group data
                    this.phases = event.event.phases;
                    for (let i = 0; i < this.phases.length; i++) {
                        if (this.phases[i].id == event.phaseId) {
                            this.currentPhaseIndex = i;
                            break;
                        }
                    }
                    this.getPhase(event.phaseId);
                }
            });
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

    async getPhase(phaseId) {
        let phaseRes = await this.startggService.getPhase(phaseId);
        if (phaseRes.errors) { console.log('error', phaseRes.errors[0].message); return; }

        // Get all phase groups within the phase
        for (let i = 0; i < phaseRes.data.phase.phaseGroups.nodes.length; i++) {
            this.phaseGroups.push();
            this.maxRounds.push([]);
            this.getPhaseGroup(phaseRes.data.phase.phaseGroups.nodes[i], i);
        }
    }

    async getPhaseGroup(phaseGroup, phaseGroupIndex) {
        let phaseGroupSetsRes = await this.startggService.getPhaseGroupSets(phaseGroup.id, phaseGroup.sets.pageInfo.total);
        if (phaseGroupSetsRes.errors) { console.log('error', phaseGroupSetsRes.errors[0].message); return; }

        phaseGroup.sets = phaseGroupSetsRes;
        let phaseGroupSets = phaseGroup.sets.nodes;

        // Add entrant data to each set
        phaseGroupSets.forEach(set => {
            set.slots.forEach(slot => {
                let entrant = this.entrants.find(entrant => entrant.id == slot?.entrant?.id);
                if (entrant) {
                    slot.entrant.participants = entrant.participants;
                    slot.entrant.seed = entrant.seed;
                    slot.entrant.backgroundColor = entrant.backgroundColor;
                }
            });
        });

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

        // Stores the max round number for each side of bracket and updates the max rounds for the phase
        let winnersMaxRound = phaseGroupSets[phaseGroupSets.length - 1].round;
        let losersMaxRound = Math.abs(phaseGroupSets[0].round);
        this.maxRounds[phaseGroupIndex] = [winnersMaxRound, losersMaxRound];
        this.maxRoundsPhase = Math.max(this.maxRoundsPhase, winnersMaxRound, losersMaxRound);

        // Convert set data into arrays
        phaseGroup.sets.nodes = [[], []];
        for (let i = 0; i < winnersMaxRound; i++) phaseGroup.sets.nodes[0].push(Array.from(phaseGroupSets.filter(set => set.round == i + 1)));
        for (let i = 0; i < losersMaxRound; i++) phaseGroup.sets.nodes[1].push(Array.from(phaseGroupSets.filter(set => set.round == (i + 1) * -1)));

        // Calculate the number of players per phase group
        phaseGroup.numPlayers = this.getNumberOfPlayers(phaseGroup);


        this.phaseGroups[phaseGroupIndex] = phaseGroup;
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
            // Get the distance between two powers of 2 for the number of players
            let powerOfPlayersRemainder = Math.log(phaseGroup.numPlayers) / Math.log(2) % 1;

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
        else if (bracketSide == 1 && Math.log(phaseGroup.numPlayers) / Math.log(2) % 1 > 0.584962500) {
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
        let fullRoundIndex = 0;
        let sets = phaseGroup.sets.nodes;

        // Looking for the first round in winner's with a number of sets that's a power of 2 that then decreases after that round
        while ((sets[0][fullRoundIndex].length & (sets[0][fullRoundIndex].length - 1)) != 0 || sets[0][fullRoundIndex].length < sets[0][fullRoundIndex + 1].length) fullRoundIndex++;

        let numberOfPlayers = 0;
        let fullRoundLength = sets[0][fullRoundIndex].length;
        numberOfPlayers += fullRoundLength * 2;

        // Adding the total number of sets in loser's in rounds where the number of sets is greater than half of the fullRoundLength
        for (let i = 0; sets[1][i].length != fullRoundLength / 2 || sets[1][i].length < sets[1][i + 1].length; i++) numberOfPlayers += sets[1][i].length;

        return numberOfPlayers;
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

    getPhaseGroupSideHeight(phaseGroup, side) {
        let multiplier = 110;

        // If it's winner's side
        if (side == 0) {
            // If winner's only has one round
            if (phaseGroup.sets.nodes[0].length == 1) return this.getRoundSets(phaseGroup, 1).length * multiplier;

            // If winner's has more than one round
            return Math.max(this.getRoundSets(phaseGroup, 1).length, this.getRoundSets(phaseGroup, 2).length) * multiplier;
        }

        // If it's losers' side
        else {
            // If loser's only has one round
            if (phaseGroup.sets.nodes[1].length == 1) return this.getRoundSets(phaseGroup, -1).length * multiplier;

            // If loser's has more than one round
            return Math.max(this.getRoundSets(phaseGroup, -1).length, this.getRoundSets(phaseGroup, -2).length) * multiplier;
        }
    }

    changePhase(direction) {
        let url = this.router.url;
        if (url.indexOf('/brackets') == -1) url += '/brackets';
        this.router.navigate([url.slice(0, url.indexOf('/brackets') + '/brackets'.length) + '/' + this.phases[this.currentPhaseIndex + direction].id]);
    }

    isWinner(set, slot, typeOfDisplay) {
        if (!slot.entrant) return `loser-${typeOfDisplay}`;
        return slot.entrant.id == set.winnerId ? `winner-${typeOfDisplay}` : `loser-${typeOfDisplay}`;
    }

    getScore(slot, set) {
        if (!slot.standing) return '‎';
        if (!isNaN(slot.standing.stats.score.value)) {
            if (slot.standing.stats.score.value == -1) return 'DQ';
            return slot.standing.stats.score.value;
        }

        let otherSlot = set.slots.find(s => s.id != slot.id);
        return otherSlot.standing ? 0 : '‎';
    }

    getSlotHeight(firstSlot) {
        let normalSlotHeight = (this.setHeight - 0.67) / 2;
        return (firstSlot ? normalSlotHeight + 0.67 : normalSlotHeight) + 'px';
    }

    getSeedFontSize(slot) {
        if (!slot.standing) return null;
        if (slot.entrant.seed < 100) return '12px';
        if (slot.entrant.seed < 1000) return '10px';
        return '8px';
    }

    getScoreFontSize(slot) {
        return slot.standing?.stats.score.value == -1 ? '12px' : '14px';
    }

    getScoreFontWeight(slot) {
        return slot.standing?.stats.score.value == -1 ? 'bold' : 'normal';
    }

    getColumnWidth(column) {
        return column % 3 == 0 ? '204px' : '22px';
    }

    _filterEntrants(value) {
        const filterValue = value.toLowerCase();
        return this.entrants.filter(entrant => entrant.name.toLowerCase().includes(filterValue));
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
}