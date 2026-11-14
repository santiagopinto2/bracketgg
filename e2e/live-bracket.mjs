// A walk through the real Genesis X Melee Singles brackets in a browser, for the progression tags:
// screenshots in the dark theme (two in light too) and a JSON report of what happened. It asks the real start.gg (about
// 30 requests) through the app's own server, which needs the site token:
//
//   PORT=4304 STATIC_DIR=<build> STARTGG_SITE_TOKEN=<token> node proxy-server.js
//   node e2e/live-bracket.mjs http://localhost:4304 <out dir>
//
// It only reports. start.gg being slow or rate limiting must not fail a build, so it always exits 0.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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
    return { context, page, errors };
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
        const { context, page, errors } = await open();
        try {
            await page.goto(appUrl + brackets + '/1572545/2357765?player=15484977');
            report.steps.r2Pools = { ...await arrival(page), errors };
            await page.screenshot({ path: `${outDir}/arrival-r2-pools.png` });

            await loaded(page);
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
console.log(JSON.stringify(report, null, 2));
