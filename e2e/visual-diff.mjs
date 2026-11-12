// Pixel-compares two folders of screenshots from e2e/screenshots.mjs (the base branch's build and this one's).
//
//   node e2e/visual-diff.mjs <base dir> <branch dir> <diff dir>
//
// Writes a diff image (changed pixels in red) for each screenshot that differs, prints a JSON report and
// exits 1 if any screenshot is missing, changed size, or has more than a few changed pixels.
// Needs the pixelmatch and pngjs packages (npm install --no-save pixelmatch pngjs).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const [baseDir, branchDir, diffDir] = process.argv.slice(2);
// A pixel counts as changed past pixelmatch's color threshold; a screenshot fails past this many
const allowedPixels = 10;

mkdirSync(diffDir, { recursive: true });
const names = [...new Set([baseDir, branchDir].flatMap(dir => existsSync(dir) ? readdirSync(dir) : []))].filter(n => n.endsWith('.png')).sort();
const report = { compared: 0, same: [], different: {}, missing: {} };
for (const name of names) {
    const missingFrom = [[baseDir, 'base'], [branchDir, 'branch']].filter(([dir]) => !existsSync(`${dir}/${name}`)).map(([, side]) => side);
    if (missingFrom.length) { report.missing[name] = missingFrom; continue; }
    const base = PNG.sync.read(readFileSync(`${baseDir}/${name}`));
    const branch = PNG.sync.read(readFileSync(`${branchDir}/${name}`));
    report.compared++;
    if (base.width !== branch.width || base.height !== branch.height) {
        report.different[name] = { size: `${base.width}x${base.height} -> ${branch.width}x${branch.height}` };
        continue;
    }
    const diff = new PNG({ width: base.width, height: base.height });
    const changed = pixelmatch(base.data, branch.data, diff.data, base.width, base.height, { threshold: 0.1 });
    if (changed > allowedPixels) {
        report.different[name] = { changedPixels: changed };
        writeFileSync(`${diffDir}/${name}`, PNG.sync.write(diff));
    } else {
        report.same.push(changed ? `${name} (${changed} px)` : name);
    }
}
// A screenshot that couldn't be taken (screenshots.json gives the error), or none at all, is a failure too
report.notTaken = {};
for (const [dir, side] of [[baseDir, 'base'], [branchDir, 'branch']]) {
    const taken = existsSync(`${dir}/screenshots.json`) ? JSON.parse(readFileSync(`${dir}/screenshots.json`)) : { all: 'no screenshots.json' };
    for (const [name, result] of Object.entries(taken)) if (result !== 'ok') report.notTaken[`${side}: ${name}`] = result;
}
const ok = report.compared > 0 && ![report.different, report.missing, report.notTaken].some(o => Object.keys(o).length);
report.ok = ok;
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
