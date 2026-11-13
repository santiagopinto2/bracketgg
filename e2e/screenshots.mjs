// Screenshots of the same pages, at the same sizes, for e2e/visual-diff.mjs to compare between two builds.
// Run through api-calls.mjs, which owns the fake start.gg:
//
//   node e2e/api-calls.mjs <app url> --screenshots <dir>
//
// Animations and transitions are off and the text cursor is hidden, so two runs of one build match.
import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const landingPath = '/tournament/test-tourney/event/test-event';
const sizes = {
    desktop: { viewport: { width: 1280, height: 1000 } },
    phone: devices['Pixel 7'],
};
const still = '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }';

// Each page: where it starts and what to do there before the screenshot
const shots = eventPath => ({
    home: { path: '/' },
    'event-landing': { path: landingPath },
    'double-elim': { path: eventPath + '/1001' },
    'single-elim': { path: eventPath + '/1006' },
    'set-popup': { path: eventPath + '/1001', act: page => page.locator('.set', { hasText: 'Delta' }).filter({ hasText: 'Alpha' }).first().click() },
    'phase-menu': { path: eventPath + '/1001', act: page => page.locator('.phase-menu-button').click() },
    tournament: { path: '/tournament/test-tourney' },
    search: { path: eventPath + '/1001', act: async page => {
        await page.locator('.search-entrant-form input').click();
        await page.locator('.search-entrant-form input').fill('a');
    } },
    // The end of a bracket, where the footer is
    'bracket-end': { path: eventPath + '/1001', act: page => page.locator('mat-sidenav-content').evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })) },
    privacy: { path: '/privacy' },
    // As a visitor: the header's login button on desktop, and the phone's menu
    'home-visitor': { path: '/', visitor: true },
    'menu-visitor': { path: '/', visitor: true, phoneOnly: true, act: openMenu },
    menu: { path: '/tournament/test-tourney', phoneOnly: true, act: openMenu },
});
const openMenu = page => page.locator('mat-toolbar button:has(mat-icon:text("menu"))').click();

export async function takeScreenshots({ appUrl, eventPath, openPage, outDir }) {
    mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch();
    const report = {};
    try {
        for (const [name, shot] of Object.entries(shots(eventPath))) {
            for (const [size, device] of Object.entries(sizes)) {
                // Every page in both themes
                for (const scheme of ['dark', 'light']) {
                    if (shot.phoneOnly && size !== 'phone') continue;
                    const file = `${name}-${size}-${scheme}`;
                    const { context, page, quiet } = await openPage(browser, () => null, { ...device, colorScheme: scheme, reducedMotion: 'reduce' }, { fonts: true, loggedIn: !shot.visitor });
                    try {
                        // The visitor's chosen theme (builds before the theme button followed colorScheme instead)
                        if (scheme === 'light') await page.addInitScript(() => localStorage.setItem('bgg-theme', 'light'));
                        // The colored initials pick a random color: the same seed gives both builds the same colors
                        await page.addInitScript(() => {
                            let seed = 12345;
                            Math.random = () => {
                                seed = (seed + 0x6D2B79F5) | 0;
                                let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                            };
                        });
                        await page.goto(appUrl + shot.path);
                        await page.addStyleTag({ content: still });
                        await quiet();
                        await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.images].every(image => image.complete), null, { timeout: 15000 });
                        if (shot.act) {
                            await shot.act(page);
                            await quiet(800);
                        }
                        await page.waitForTimeout(500);
                        await page.screenshot({ path: `${outDir}/${file}.png`, animations: 'disabled', caret: 'hide' });
                        report[file] = 'ok';
                    } catch (e) {
                        report[file] = String(e.message).slice(0, 300);
                    }
                    await context.close();
                }
            }
        }
    } finally {
        await browser.close();
    }
    writeFileSync(`${outDir}/screenshots.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
