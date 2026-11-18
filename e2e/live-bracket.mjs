// A walk through the real Genesis X Melee Singles brackets in a browser, for the progression tags:
// screenshots in the dark theme (two in light too) and a JSON report of what happened. Then Show
// Projected across phases checked against two finished events, straight from start.gg. It asks the real start.gg (about
// 30 requests) through the app's own server, which needs the site token:
//
//   PORT=4304 STATIC_DIR=<build> STARTGG_SITE_TOKEN=<token> node proxy-server.js
//   node e2e/live-bracket.mjs http://localhost:4304 <out dir>
//
// It only reports. start.gg being slow or rate limiting must not fail a build, so it always exits 0.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { askStartgg } from './startgg-live.mjs';
const { phaseProgressionsQuery, phaseQuery, poolSetsQuery } = await import('../src/app/services/startgg-queries.ts');
const { projectAcrossPhases } = await import('../src/app/components/event/projection.ts');

const [appUrl = 'http://localhost:4304', outDir = 'e2e-out/live-bracket'] = process.argv.slice(2);
const brackets = '/tournament/genesis-x/event/melee-singles/brackets';
mkdirSync(outDir, { recursive: true });
const report = { app: appUrl, steps: {} };
const browser = await chromium.launch();

const open = async () => {
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
    // The requests the page sends to start.gg (through /api/gql), by the query's name
    const requests = {};
    page.on('request', request => {
        if (request.method() !== 'POST' || !request.url().endsWith('/api/gql')) return;
        const name = request.postDataJSON()?.query?.match(/query (\w+)/)?.[1] ?? 'other';
        requests[name] = (requests[name] ?? 0) + 1;
    });
    return { context, page, errors, requests };
};
// Waits for the set the bracket scrolled to, and says which it is and where it sits in the view
const arrival = async (page, timeout = 120000) => {
    await page.locator('.set-arrived').waitFor({ timeout });
    return page.evaluate(() => {
        const set = document.querySelector('.set-arrived');
        const box = document.querySelector('mat-sidenav-content').getBoundingClientRect(), r = set.getBoundingClientRect();
        return { set: set.getAttribute('data-set-id'), players: [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.trim()),
            tags: [...set.querySelectorAll('.progression-tag')].map(tag => [[...tag.children].map(part => part.textContent.trim()).join(' '), tag.getAttribute('href')]),
            pool: set.closest('[data-pool-index]')?.id, poolsDrawn: [...document.querySelectorAll('[data-pool-index]')].filter(row => row.querySelector('.set')).length,
            offCenter: [Math.round((r.left + r.right) / 2 - (box.left + box.right) / 2), Math.round((r.top + r.bottom) / 2 - (box.top + box.bottom) / 2)],
            url: location.pathname + location.search, dark: document.documentElement.getAttribute('data-theme') === 'dark' };
    });
};
// Runs `act` with the page in the light theme, then puts the dark theme back
const inLight = async (page, act) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(400); // colors fade from one theme to the other
    await act();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
};
const loaded = page => page.locator('app-snack-bar mat-spinner').waitFor({ state: 'hidden', timeout: 180000 });

try {
    // 1. R1 Pools (64 pools), opened at pool A505 and its winners semi-final, whose winner and loser
    //    both go on to R2 Pools. Closed as soon as that pool is drawn, so the other pools aren't asked for.
    {
        const { context, page, errors } = await open();
        try {
            await page.goto(appUrl + brackets + '/1465054/2341829?set=70842734');
            report.steps.r1Pools = { ...await arrival(page), errors };
            // The tags come from R2 Pools' seeds, asked for alongside the sets, so they can come a moment later
            const tags = page.locator('[data-set-id="70842734"] .progression-tag');
            await tags.first().waitFor({ timeout: 60000 });
            report.steps.r1Pools.tags = await tags.evaluateAll(all => all.map(tag => [[...tag.children].map(part => part.textContent.trim()).join(' '), tag.getAttribute('href')]));
            await page.screenshot({ path: `${outDir}/tags-r1-pools.png` });
        } catch (e) {
            report.steps.r1Pools = { failed: String(e.message).slice(0, 300), errors };
        }
        await context.close();
    }

    // 2. R2 Pools (16 pools), opened the way a tag in R1 Pools links to it: pool H517 and a player
    //    who came from pool A505. Then the tag beside one of H517's sets is followed to Top 64.
    {
        const { context, page, errors, requests } = await open();
        try {
            await page.goto(appUrl + brackets + '/1572545/2357765?player=15484977');
            report.steps.r2Pools = { ...await arrival(page), errors };
            await page.screenshot({ path: `${outDir}/arrival-r2-pools.png` });

            await loaded(page);
            // What all of R2 Pools cost: its 16 pools' sets in pool slices, and Top 64's seeds for the tags
            report.steps.r2Requests = { ...requests };
            await page.waitForTimeout(4000); // the outline has gone
            const tag = page.locator('#pool-2357765 .progression-tag').first();
            await tag.waitFor({ timeout: 60000 });
            const tagged = await tag.evaluate(el => {
                const set = el.closest('.set');
                set.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                return { set: set.getAttribute('data-set-id'), tag: [...el.children].map(part => part.textContent.trim()).join(' '), href: el.getAttribute('href'),
                    tagsInPool: document.querySelectorAll('#pool-2357765 .progression-tag').length, tagsInPhase: document.querySelectorAll('.progression-tag').length,
                    poolsDrawn: [...document.querySelectorAll('[data-pool-index]')].filter(row => row.querySelector('.set')).length };
            });
            report.steps.r2Tags = tagged;
            await page.waitForTimeout(300);
            await page.screenshot({ path: `${outDir}/tags-r2-pools.png` });
            await inLight(page, () => page.screenshot({ path: `${outDir}/tags-r2-pools-light.png` }));

            await tag.click();
            await page.mouse.move(5, 5);
            report.steps.top64 = { ...await arrival(page), errors };
            await page.screenshot({ path: `${outDir}/arrival-top-64.png` });
            await inLight(page, () => page.screenshot({ path: `${outDir}/arrival-top-64-light.png` }));

            await loaded(page);
            await page.goBack();
            report.steps.back = { ...await arrival(page), errors };
        } catch (e) {
            report.steps.failed = { failed: String(e.message).slice(0, 300), errors };
        }
        await context.close();
    }
} finally {
    await browser.close();
}

// 3. Show Projected across phases, straight from start.gg (STARTGG_TOKEN, about 12 requests): for finished
//    events, the next phase's seeds are emptied as if start.gg hadn't placed anyone yet, and projected from
//    the earlier phase's real pools. Every seed should get the player start.gg placed there.
if (process.env.STARTGG_TOKEN) {
    const ask = async (query, variables) => (await askStartgg(process.env.STARTGG_TOKEN, query, variables)).json?.data;
    const crossPhase = async (name, phases, shownPhaseId) => {
        try {
            const [earlier, shown] = phases;
            const loaded = new Map();
            for (const phase of phases) loaded.set(String(phase.id), (await ask(phaseQuery, { phaseId: phase.id }))?.phase);
            const pools = new Map();
            for (const group of loaded.get(String(earlier.id))?.phaseGroups?.nodes ?? []) {
                const sets = [];
                for (let page = 1; page <= 3; page++) {
                    const nodes = (await ask(poolSetsQuery, { id: Number(group.id), page, perPage: 90 }))?.phaseGroup?.sets?.nodes ?? [];
                    sets.push(...nodes);
                    if (nodes.length < 90) break;
                }
                pools.set(String(group.id), sets);
            }
            const seedsOf = new Map();
            for (const phase of phases) seedsOf.set(String(phase.id), (await ask(phaseProgressionsQuery, { phaseId: phase.id, page: 1, perPage: 200 }))?.phase?.seeds?.nodes ?? []);
            const real = seedsOf.get(String(shownPhaseId));
            seedsOf.set(String(shownPhaseId), real.map(seed => ({ ...seed, entrant: null })));
            const shownPools = loaded.get(String(shownPhaseId))?.phaseGroups?.nodes?.map(group => group.id) ?? [];
            const result = projectAcrossPhases(shownPhaseId, shownPools, {
                phases, phase: id => loaded.get(id) ?? null, poolSets: id => pools.get(id) ?? null, seeds: id => seedsOf.get(id) ?? null,
            });
            const projected = new Map([...result.fills.values()].flatMap(fill => [...fill.bySeedId].map(([id, slot]) => [id, slot.entrant?.id])));
            const differ = real.filter(seed => projected.has(String(seed.id)) && projected.get(String(seed.id)) !== seed.entrant?.id).map(seed => seed.id);
            report.steps[name] = { seeds: real.length, filled: projected.size, same: projected.size - differ.length, differ, missing: [...result.missing.pools.keys(), ...result.missing.phases, ...result.missing.seeds] };
        } catch (e) {
            report.steps[name] = { failed: String(e.message).slice(0, 300) };
        }
    };
    // Genesis X: Top 64 into Top 8 (every one of Top 8's players comes out of Top 64)
    await crossPhase('projectedTop8', [{ id: 1560208, progressingInData: [{ origin: 1572545 }] }, { id: 1560209, progressingInData: [{ origin: 1560208 }] }], 1560209);
    // A weekly (NYC Melee's Stock Exchange 73): two pools with byes into a Top 16, half of it on the losers side
    await crossPhase('projectedTop16', [{ id: 2447128, progressingInData: [] }, { id: 2447129, progressingInData: [{ origin: 2447128 }] }], 2447129);
}
console.log(JSON.stringify(report, null, 2));
