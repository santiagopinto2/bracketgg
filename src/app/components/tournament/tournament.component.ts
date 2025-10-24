import { AfterViewInit, Component, OnDestroy, OnInit, ViewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { SetOrderConstants } from './set-order-constants';
import { Subject } from 'rxjs/internal/Subject';
import { map, startWith, takeUntil } from 'rxjs/operators';
import { NgIf, NgFor, NgStyle, NgClass, AsyncPipe } from '@angular/common';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatInputModule } from '@angular/material/input';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SetComponent } from '../set/set.component';
import { LoadingService } from 'src/app/services/loading.service';
import { DeviceDetectorService } from 'ngx-device-detector';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
    selector: 'app-tournament',
    templateUrl: './tournament.component.html',
    styleUrls: ['./tournament.component.scss'],
    imports: [NgIf, MatIconButton, MatIconModule, NgFor, NgStyle, NgClass, MatFormFieldModule, MatAutocompleteModule, MatInputModule, FormsModule, ReactiveFormsModule, AsyncPipe, MatButtonModule, MatCheckboxModule]
})
export class TournamentComponent implements OnInit, AfterViewInit, OnDestroy {

    destroy$ = new Subject();
    isDesktop = false;
    scrollToTopOffset = 20;
    eventId = -1;
    allEntrants = [];
    entrants = [];
    entrantCtrl = new FormControl('');
    filteredEntrants: Observable<any>;
    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    projected = [];
    maxRounds = [];
    maxRoundModifier = [1, -1];
    maxRoundsPhase = -1;
    canHover = true;
    playerHovered = -1;
    isGrabbing = false;
    showUpsets = false;
    showProjected = false;
    phaseProperties;
    // setHeight should be a multiple of 4 plus 0.67
    setHeight = 52.67;

    @ViewChildren('slot') slotElements: any;

    constructor(
        private startggService: StartggService,
        private tournamentDataService: TournamentDataService,
        private loadingService: LoadingService,
        private deviceService: DeviceDetectorService,
        private dialog: MatDialog,
        private router: Router
    ) {
        this.isDesktop = this.deviceService.isDesktop();

        // Start filtering the search entrants form
        this.filteredEntrants = this.entrantCtrl.valueChanges.pipe(
            startWith(''),
            map(entrant => (entrant ? this._filterEntrants(entrant) : this.entrants.slice())),
        );
    }

    ngOnInit() {
        this.showUpsets = localStorage.getItem('showUpsets') === 'true';
        this.showProjected = localStorage.getItem('showProjected') === 'true';

        this.tournamentDataService.eventSource$
            .pipe(takeUntil(this.destroy$))
            .subscribe(event => {
                // Clear data
                this.phases = [];
                this.currentPhaseIndex = -1;
                this.phaseGroups = [];
                this.projected = [];
                this.maxRounds = [];
                this.maxRoundsPhase = -1;
                this.entrants = [];
                this.playerHovered = -1;

                // Clear this data only if there is no event
                if (!event.phaseId) {
                    this.eventId = -1;
                    this.allEntrants = [];
                }
                else {
                    // Get entrants only if the event changes
                    if (event.event.id != this.eventId) {
                        this.eventId = event.event.id;

                        this.allEntrants = event.event.entrants.nodes;
                        this.allEntrants.forEach(entrant => {
                            if (!entrant.participants[0].user) entrant.participants[0].user = { images: [] };

                            if (this.getEntrantImage(entrant) === '') {
                                const hue = Math.floor(Math.random() * 361);
                                const sat = Math.floor(Math.random() * 101);
                                const lum = 40;
                                entrant.backgroundColor = `hsl(${hue}, ${sat}%, ${lum}%)`;
                            }

                            let pipeIndex = entrant.name.lastIndexOf('|');
                            if (pipeIndex != -1) {
                                entrant.sponsor = entrant.name.slice(0, pipeIndex - 1);
                                entrant.name = entrant.name.slice(pipeIndex + 2);
                            }
                        });
                    }

                    // Get all phase and phase group data
                    this.phases = event.event.phases;
                    this.currentPhaseIndex = this.phases.findIndex(phase => phase.id == event.phaseId);
                    this.getPhase(event.phaseId);
                }

                setTimeout(() => {
                    this.getScrollToTopOffset();
                });
            });
    }

    ngAfterViewInit() {
        // Horizontal and vertical drag

        let mouseDown = false;
        let startX, scrollLeft, startY, scrollTop;
        const sidenavContentElement = document.querySelector<HTMLElement>('.mat-sidenav-content');

        const startDragging = event => {
            this.isGrabbing = true;
            mouseDown = true;

            startX = event.pageX - sidenavContentElement.offsetLeft;
            scrollLeft = sidenavContentElement.scrollLeft;

            startY = event.pageY - sidenavContentElement.offsetTop;
            scrollTop = sidenavContentElement.scrollTop;
        }

        const stopDragging = event => {
            this.isGrabbing = false;
            mouseDown = false;
        }

        const move = event => {
            event.preventDefault();
            if (!mouseDown) return;

            const x = event.pageX - sidenavContentElement.offsetLeft;
            const horizontalScroll = x - startX;
            sidenavContentElement.scrollLeft = scrollLeft - horizontalScroll;

            const y = event.pageY - sidenavContentElement.offsetTop;
            const verticalScroll = y - startY;
            sidenavContentElement.scrollTop = scrollTop - verticalScroll;
        }

        sidenavContentElement.addEventListener('mousemove', move, false);
        sidenavContentElement.addEventListener('mousedown', startDragging, false);
        sidenavContentElement.addEventListener('mouseup', stopDragging, false);
        sidenavContentElement.addEventListener('mouseleave', stopDragging, false);
    }

    ngOnDestroy() {
        this.destroy$.next(null);
    }

    async getPhase(phaseId) {
        let phaseRes = await this.startggService.getPhase(phaseId);
        if (phaseRes.errors) { console.log('error', phaseRes.errors[0].message); return; }
        this.phaseProperties = await this.startggService.getPhaseProperties(phaseRes.data.phase.phaseGroups.nodes[0].id);

        // Get all phase groups within the phase
        let phaseGroupPromises = [];
        for (let i = 0; i < phaseRes.data.phase.phaseGroups.nodes.length; i++) {
            this.phaseGroups.push();
            this.projected.push();
            this.maxRounds.push([]);
            const phaseGroupPromise = this.getPhaseGroup(phaseRes.data.phase.phaseGroups.nodes[i], i);
            phaseGroupPromises.push(phaseGroupPromise);
        }

        await Promise.all(phaseGroupPromises);
        this.loadingService.updateValue(false);
    }

    async getPhaseGroup(phaseGroup, phaseGroupIndex) {
        let phaseGroupSetsRes = await this.startggService.getPhaseGroupSets(phaseGroup.id, phaseGroup.sets.pageInfo.total, this.phaseProperties);
        if (phaseGroupSetsRes.errors) { console.log('error', phaseGroupSetsRes.errors[0].message); return; }

        phaseGroup.sets = phaseGroupSetsRes;
        let phaseGroupSets = phaseGroup.sets.nodes;

        // Add entrant data to each set and add unique entrants to entrant list
        phaseGroupSets.forEach(set => {
            set.slots.forEach(slot => {
                let entrant = this.allEntrants.find(entrant => entrant.id == slot?.entrant?.id);
                if (entrant) {
                    slot.entrant.name = entrant.name;
                    slot.entrant.sponsor = entrant.sponsor;
                    slot.entrant.participants = entrant.participants;
                    slot.entrant.initialSeedNum = entrant.initialSeedNum;
                    slot.entrant.backgroundColor = entrant.backgroundColor;
                    if (!this.entrants.some(e => e.id == slot.entrant.id)) this.entrants.push(slot.entrant);
                }
            });
        });
        this.entrantCtrl.setValue('');

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
        phaseGroupSets.sort((a, b) => {
            if (a.round != b.round) return a.round - b.round;
            if (isNaN(a.id) && a.id.includes('preview_')) {
                let aEndId = Number(a.id.slice(a.id.lastIndexOf('_') + 1));
                let bEndId = Number(b.id.slice(b.id.lastIndexOf('_') + 1));
                return aEndId - bEndId;
            }
            return a.id - b.id;
        });

        // Stores the max round number for each side of bracket and updates the max rounds for the phase
        let winnersMaxRound = phaseGroupSets[phaseGroupSets.length - 1].round;
        let losersMaxRound = Math.abs(phaseGroupSets[0].round);
        this.maxRounds[phaseGroupIndex] = [winnersMaxRound, losersMaxRound];
        this.maxRoundsPhase = Math.max(this.maxRoundsPhase, winnersMaxRound, losersMaxRound);

        // Convert set data into arrays
        phaseGroup.sets.nodes = [[], []];
        for (let i = 0; i < winnersMaxRound; i++) phaseGroup.sets.nodes[0].push(Array.from(phaseGroupSets.filter(set => set.round == i + 1)));
        for (let i = 0; i < losersMaxRound; i++) phaseGroup.sets.nodes[1].push(Array.from(phaseGroupSets.filter(set => set.round == (i + 1) * -1)));

        // Organize set games data
        phaseGroupSets.forEach(set => {
            if (set.games) {
                set.games.forEach(game => {
                    if (game.selections && game.selections[0].entrant.id != set.slots[0].entrant.id) {
                        let tempSelection = game.selections[0];
                        game.selections[0] = game.selections[1];
                        game.selections[1] = tempSelection;
                    }
                });
            }
        });

        // Calculate the number of players per phase group
        phaseGroup.numPlayers = this.getNumberOfPlayers(phaseGroup);

        // Set all projected sets of the phase group
        this.projected[phaseGroupIndex] = this.getProjected(phaseGroup);

        // Finally set the phase group
        this.phaseGroups[phaseGroupIndex] = phaseGroup;
        
        setTimeout(() => {
            this.getScrollToTopOffset();
        });
    }

    getProjected(phaseGroup) {
        let projectedPhaseGroup = structuredClone(phaseGroup.sets.nodes);

        // Get all projections in winners and set projections in losers that come from winners
        let lastWinnersRoundSets = projectedPhaseGroup[0][projectedPhaseGroup[0].length - 1];
        if (lastWinnersRoundSets[0].fullRoundText === 'Grand Final Reset') {
            return projectedPhaseGroup;
        }
        if (lastWinnersRoundSets[0].fullRoundText === 'Grand Final') {
            this.getProjectedSet(projectedPhaseGroup, phaseGroup.numPlayers, 0, projectedPhaseGroup[0].length - 2, 0);
        }
        else {
            for(let i = 0; i < lastWinnersRoundSets.length; i++) {
                this.getProjectedSet(projectedPhaseGroup, phaseGroup.numPlayers, 0, projectedPhaseGroup[0].length - 1, i);
            }
        }

        // Get the rest of projections in losers
        for(let i = 0; i < projectedPhaseGroup[1][projectedPhaseGroup[1].length - 1].length; i++) {
            this.getProjectedSet(projectedPhaseGroup, phaseGroup.numPlayers, 1, projectedPhaseGroup[1].length - 1, i);
        }

        // Get grand finals projections
        let grandsSetOneSlots = lastWinnersRoundSets[0].slots;
        if (!grandsSetOneSlots[0].entrant) {
            let winnersFinalsSlots = structuredClone(projectedPhaseGroup[0][projectedPhaseGroup[0].length - 2][0].slots);
            grandsSetOneSlots[0] = this.setProjectedSlot(this.getLowerHigherSeed(winnersFinalsSlots, false));
        }
        if (!grandsSetOneSlots[1].entrant) {
            let losersFinalsSlots = structuredClone(projectedPhaseGroup[1][projectedPhaseGroup[1].length - 1][0].slots);
            grandsSetOneSlots[1] = this.setProjectedSlot(this.getLowerHigherSeed(losersFinalsSlots, false));
        }

        return projectedPhaseGroup;
    }

    getProjectedSet(projectedPhaseGroup, numPlayers, side, round, setIndex) {
        // Get relative set index
        let setIndexRelative = setIndex;
        if (side == 0 && round == 0) {
            let setCountFull = projectedPhaseGroup[side][1] ? projectedPhaseGroup[side][1].length * 2 : projectedPhaseGroup[side][0].length;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, projectedPhaseGroup[side][round].length, false);
            setIndexRelative = addedSetIndexes.slice(0, setIndex).filter(value => value).length;
        }
        else if (side == 1 && round != 0 && projectedPhaseGroup[side][round][0].fullRoundText !== 'Losers Final' && projectedPhaseGroup[side][round + 1] && projectedPhaseGroup[side][round].length == projectedPhaseGroup[side][round + 1].length) {
            setIndexRelative = Math.trunc(setIndex / 2);
        }
        else if (side == 1 && round == 0 && projectedPhaseGroup[side][round + 1]) {
            let setCountFull = -1;
            let sliceEnd = -1;
            if (projectedPhaseGroup[side][round].length > projectedPhaseGroup[side][round + 1].length) {
                setCountFull = projectedPhaseGroup[side][1].length * 2;
                sliceEnd = setIndex;
            }
            else {
                setCountFull = projectedPhaseGroup[side][1].length;
                sliceEnd = Math.trunc(setIndex / 2);
            }
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, projectedPhaseGroup[side][round].length, false);
            setIndexRelative = addedSetIndexes.slice(0, sliceEnd).filter(value => value).length;
        }

        // Recursively goes back rounds looking for entrants
        let slots = projectedPhaseGroup[side][round][setIndexRelative].slots;
        if (!slots[0].entrant && round != 0) slots[0] = this.setProjectedSlot(this.getProjectedSet(projectedPhaseGroup, numPlayers, side, round - 1, setIndexRelative * 2))
        if (!slots[1].entrant && round != 0) slots[1] = this.setProjectedSlot(this.getProjectedSet(projectedPhaseGroup, numPlayers, side, round - 1, setIndexRelative * 2 + 1));

        // Sets the projected sets in losers that are coming from winners
        if (side == 0 && !projectedPhaseGroup[side][round][setIndexRelative].winnerId && (slots[0].entrant || slots[1].entrant)) {
            // Get the distance between two powers of 2 for the number of players
            let powerOfPlayersRemainder = this.getPowerOfPlayersRemainder(numPlayers);

            let roundInLosers = powerOfPlayersRemainder > 0.584962501 || powerOfPlayersRemainder == 0 ? round * 2 - 1 : (round - 1) * 2;
            if (roundInLosers < 0) roundInLosers = 0;
            let roundInLosersSets = projectedPhaseGroup[1][roundInLosers];

            let lowerSeed = this.setProjectedSlot(this.getLowerHigherSeed(slots, true));

            /* 
            Sets in losers that are coming from winners follow this pattern


            Winners Round 1
            Losers Round 1 Normal

            Winners Round 2
            Losers Round 2 Full Reverse

            Winners Round 3
            Losers Round 4 Same Side, Reverse

            Winners Round 4
            Losers Round 6 Wrong Side, Normal

            Winners Round 5
            Losers Round 8 Normal


            Winners Semis
            Losers Quarters Flip Flops every time (3rd and 4th seeds)
            */

            // If it's winners finals
            if (projectedPhaseGroup[side][round][0].fullRoundText === 'Winners Final') roundInLosersSets[0].slots[0] = lowerSeed;
            // If it's winners round 1
            else if (round == 0) {
                // If the player count is greater than 1/2 of the way between powers of 2 or a power of 2
                if (powerOfPlayersRemainder > 0.584962501 || powerOfPlayersRemainder == 0) {
                    let losersSetCountFull = projectedPhaseGroup[0][round + 1].length;
                    let losersAddedSetIndexes = this.getAddedSetIndexes(losersSetCountFull, roundInLosersSets.length, false);
                    let losersSetIndexRelative = losersAddedSetIndexes.slice(0, Math.trunc(setIndex / 2)).filter(value => value).length;

                    if (losersAddedSetIndexes[Math.trunc(setIndex / 2)]) roundInLosersSets[losersSetIndexRelative].slots[setIndex % 2] = lowerSeed;
                    else projectedPhaseGroup[1][1][Math.trunc(setIndex / 2)].slots[1] = lowerSeed;
                }
                // If the player count is less than 1/2 of the way between powers of 2
                else roundInLosersSets[setIndexRelative].slots[1] = lowerSeed;
            }
            // If it's winners round 2
            else if (round == 1) {
                // If the player count is greater than 1/2 of the way between powers of 2 or a power of 2
                if (powerOfPlayersRemainder > 0.584962501 || powerOfPlayersRemainder == 0) roundInLosersSets[roundInLosersSets.length - setIndex - 1].slots[0] = lowerSeed;
                // If the player count is less than 1/2 of the way between powers of 2
                else {
                    let losersSetCountFull = projectedPhaseGroup[0][round].length;
                    let losersAddedSetIndexes = this.getAddedSetIndexes(losersSetCountFull, roundInLosersSets.length, true);
                    let losersSetIndexRelative = losersAddedSetIndexes.slice(0, projectedPhaseGroup[0][round].length - setIndex - 1).filter(value => value).length;

                    if (losersAddedSetIndexes.reverse()[setIndex]) roundInLosersSets[losersSetIndexRelative].slots[0] = lowerSeed;
                    else if (projectedPhaseGroup[1][1]) projectedPhaseGroup[1][1][Math.trunc((projectedPhaseGroup[0][1].length - setIndex - 1) / 2)].slots[(setIndex + 1) % 2] = lowerSeed;
                }
            }
            // If it's winners round 3
            else if (round == 2) {
                if (setIndex < roundInLosersSets.length / 2) roundInLosersSets[roundInLosersSets.length / 2 - 1 - setIndex].slots[0] = lowerSeed;
                else roundInLosersSets[roundInLosersSets.length * 1.5 - 1 - setIndex].slots[0] = lowerSeed;
            }
            // If it's winners round 4
            else if (round == 3) {
                if (setIndex < roundInLosersSets.length / 2) roundInLosersSets[setIndex + roundInLosersSets.length / 2].slots[0] = lowerSeed;
                else roundInLosersSets[setIndex - roundInLosersSets.length / 2].slots[0] = lowerSeed;
            }
            // If it's winners round 5
            else if (round == 4) roundInLosersSets[setIndex].slots[0] = lowerSeed;
            // Start.gg has a max pool size of 128 players
            // Winners round 6 is guaranteed to be winners semis or beyond
            else roundInLosersSets[roundInLosersSets.length - setIndex - 1].slots[0] = lowerSeed;
        }

        return this.getLowerHigherSeed(slots, false);
    }

    setProjectedSlot(slot) {
        let newSlot = structuredClone(slot);
        newSlot.isProjected = true;
        newSlot.standing.stats.score.value = null;
        return newSlot;
    }

    getLowerHigherSeed(slots, isLower) {
        if (!slots[0].entrant || !slots[1].entrant) return { entrant: null, standing: null };
        if (isLower) return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum > current.entrant.initialSeedNum ? prev : current));
        return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum < current.entrant.initialSeedNum ? prev : current));
    }

    isProjected(slot) {
        return slot.isProjected ? 'projected' : '';
    }

    getRoundSets(phaseGroup, side, round, phaseGroupIndex = null) {
        if (!phaseGroup) return [];
        round = Math.abs(Math.trunc(round));

        if (this.showProjected && phaseGroupIndex != null) {
            return this.projected[phaseGroupIndex][side][round - 1];
        }
        return phaseGroup.sets.nodes[side][round - 1];
    }

    getSetMargin(phaseGroup, round, side, set) {
        let sets = this.getRoundSets(phaseGroup, side, round);
        let setCount = sets.length;
        let rightRoundSets = this.getRoundSets(phaseGroup, side, (round + Math.sign(round)));
        let rightRoundSetCount = rightRoundSets ? rightRoundSets.length : 0;
        let firstSetId = this.getSetId(sets[0]);
        let setId = this.getSetId(set);


        // If the round set count is a standard amount
        if (setCount == rightRoundSetCount || setCount / 2 == rightRoundSetCount || rightRoundSetCount == 0) {
            let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCount);
            return `${marginHeight}px 0`;
        }

        // If it's losers side
        if (side == 1) {
            // Get the distance between two powers of 2 for the number of players
            let powerOfPlayersRemainder = this.getPowerOfPlayersRemainder(phaseGroup.numPlayers);

            // If winners round 1 set count is less than 1/4 of the way between powers of 2
            if (powerOfPlayersRemainder < 0.321928094) {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = (setId - firstSetId) / 2;
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
                return `${marginTop}px 0 ${marginBottom}px`;
            }
            // If winners round 1 set count is between 1/4 and 1/2 of the way between powers of 2
            else if (powerOfPlayersRemainder < 0.584962500) {
                let setCountFull = rightRoundSetCount * 2;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = setId - firstSetId;
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
            // If winners round 1 set count is greater than 1/2 of the way between powers of 2
            else {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, false);

                let setIndexRelative = sets.findIndex(s => s.id == set.id)
                let setIndex = -1;
                let count = 0;
                for (let i = 0; i < addedSetIndexes.length; i++) {
                    if (addedSetIndexes[i]) {
                        if (count == setIndexRelative) {
                            setIndex = i;
                            break;
                        }
                        count++;
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

        // If it's winners side and the round set count is less than the next round set count
        if (setCount < rightRoundSetCount) {
            let setCountFull = rightRoundSetCount;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = (setId - firstSetId) / 2;
            let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

            let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
            let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
            return `${marginTop}px 0 ${marginBottom}px`;
        }

        // If it's winners side and the round set count is greater than the next round set count
        if (setCount > rightRoundSetCount) {
            let setCountFull = rightRoundSetCount * 2;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = setId - firstSetId;
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
        let leftRoundSetCount = this.getRoundSets(phaseGroup, bracketSide, (columnIndex / 3 + 1) * this.maxRoundModifier[bracketSide]).length;
        let rightRoundSetCount = this.getRoundSets(phaseGroup, bracketSide, (columnIndex / 3 + 2) * this.maxRoundModifier[bracketSide]).length;


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

        // If it's losers side and winners round 1 set count is greater than 1/2 of the way between powers of 2
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
        let sets = phaseGroup.sets.nodes;
        if (!sets[0][1]) return sets[0][0].length * 2;
        return sets[0][1].length * 2 + sets[0][0].length;
    }

    getPowerOfPlayersRemainder(numPlayers) {
        return Math.log(numPlayers) / Math.log(2) % 1;
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

    getSetId(set) {
        if (isNaN(set.id) && set.id.includes('preview_')) return set.id.slice(set.id.lastIndexOf('_') + 1);
        return set.id;
    }

    getPhaseGroupSideHeight(phaseGroup, side) {
        let multiplier = 110;

        // If it's winners side
        if (side == 0) {
            // If winners only has one round
            if (phaseGroup.sets.nodes[0].length == 1) return this.getRoundSets(phaseGroup, side, 1).length * multiplier;

            // If winners has more than one round
            return Math.max(this.getRoundSets(phaseGroup, side, 1).length, this.getRoundSets(phaseGroup, side, 2).length) * multiplier;
        }

        // If it's losers side
        else {
            // If losers only has one round
            if (phaseGroup.sets.nodes[1].length == 1) return this.getRoundSets(phaseGroup, side, -1).length * multiplier;

            // If losers has more than one round
            return Math.max(this.getRoundSets(phaseGroup, side, -1).length, this.getRoundSets(phaseGroup, side, -2).length) * multiplier;
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

    getSetNameWidth(set) {
        if (this.hasScore(set) && set.games && set.games[0].selections) return '108px';
        if (this.hasScore(set)) return '136px';
        return '156px';
    }
    
    getSetNamesWidthStyling(set) {
        return !this.hasScore(set) ? 'set-names-no-score' : '';
    }

    getSeedFontSize(slot) {
        if (!slot.entrant) return null;
        if (slot.entrant.initialSeedNum < 100) return '12px';
        if (slot.entrant.initialSeedNum < 1000) return '10px';
        return '8px';
    }

    getScoreFontSize(slot) {
        return slot.standing?.stats.score.value == -1 ? '12px' : '14px';
    }

    getScoreFontWeight(slot) {
        return 'normal';
        // return slot.standing?.stats.score.value == -1 ? 'bold' : 'normal';
    }

    getColumnWidth(column) {
        return column % 3 == 0 ? '204px' : '22px';
    }

    entrantSearched(event) {
        for (const element of this.slotElements.toArray()) {
            if (element.nativeElement.getAttribute('entrantId') == event.option.value.id) {
                this.playerHovered = event.option.value.id;

                document.querySelector<HTMLElement>('mat-sidenav-content').addEventListener('scroll', () => {
                    this.canHover = false;
                }, { once: true });

                setTimeout(() => {
                    element.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });

                document.querySelector<HTMLElement>('mat-sidenav-content').addEventListener('scrollend', () => {
                    this.canHover = true;
                }, { once: true });

                break;
            }
        }
    }

    entrantSearchDisplay(entrant) {
        return entrant ? entrant.name : '';
    }

    _filterEntrants(value) {
        const filterValue = value.name ? value.name.toLowerCase() : value.toLowerCase();
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

    onSlotEnter(slot) {
        if (this.canHover) this.playerHovered = slot.entrant?.id ?? -1;
    }

    onSlotLeave() {
        if (this.canHover) this.playerHovered = -1;
    }

    getSlotBackgroundColor(slot, set) {
        if (slot.entrant?.id == this.playerHovered) {
            if (this.hasScore(set)) return 'slot-hover';
            return 'slot-hover-no-score';
        }
        if (!this.showUpsets || !set.slots[0].standing || !set.slots[1].standing || set.slots[0].standing.stats.score.value == -1 || set.slots[1].standing.stats.score.value == -1 || !set.winnerId) return '';

        let winner = set.slots.find(s => s.entrant.id == set.winnerId);
        let loser = set.slots.find(s => s.entrant.id != set.winnerId);
        if (winner.entrant.id == slot.entrant.id || winner.entrant.initialSeedNum < loser.entrant.initialSeedNum) return '';

        const placements = [4097, 3073, 2049, 1537, 1025, 769, 513, 385, 257, 193, 129, 97, 65, 49, 33, 25, 17, 13, 9, 7, 5, 4, 3, 2, 1];
        const winnerPower = placements.findIndex(placement => placement <= winner.entrant.initialSeedNum);
        const loserPower = placements.findIndex(placement => placement <= loser.entrant.initialSeedNum);
        const upsetFactor = Math.min((loserPower - winnerPower), 10);
        return `upset-factor-${upsetFactor}`;
    }

    hasScore(set) {
        if (!set.slots[0].standing || !set.slots[1].standing) return false;
        return set.slots[0].standing.stats.score.value || set.slots[1].standing.stats.score.value;
    }

    hasChars(set) {
        return set.games && set.games[0].selections;
    }

    getCharIcon(set, playerIndex) {
        return set.games[0].selections[playerIndex].character.images.find(image => image.type === 'stockIcon').url;
    }

    onShowUpsetsChange(event) {
        localStorage.setItem('showUpsets', event.checked);
    }

    onShowProjectedChange(event) {
        localStorage.setItem('showProjected', event.checked);
    }

    getScrollToTopOffset() {
        const sidenavContentElement = document.querySelector<HTMLElement>('mat-sidenav-content');
        this.scrollToTopOffset = !this.isDesktop || sidenavContentElement.scrollHeight == sidenavContentElement.clientHeight ? 20 : 35;
    }

    scrollToTop() {
        const sidenavContentElement = document.querySelector<HTMLElement>('.mat-sidenav-content');
        sidenavContentElement.scroll({
            top: 0,
            left: 0,
            behavior: 'smooth'
        });
    }

    openSet(set) {
        const dialogRef = this.dialog.open(SetComponent, {
            data: { set },
            width: '800px',
            autoFocus: false
        });
    }
}