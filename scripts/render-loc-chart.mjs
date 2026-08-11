// Renders the README "where the lines go" chart into docs/assets/loc-{light,dark}.svg by
// counting the tracked library source live from git, so the picture cannot drift from the
// code. Re-run after any substantial refactor.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES as BASE_THEMES, esc, textBuilder } from './chart-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Count ────────────────────────────────────────────────────────────────────

const files = execSync('git ls-files src/lib', { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter((f) => /\.(ts|svelte)$/.test(f) && !/\/(test|e2e)\//.test(f));

// Counted from the same file list the bars are measured from: a number written into a
// label beside a live count can only ever drift out of step with it.
const bundledPluginCount = new Set(
	files
		.filter((f) => f.startsWith('src/lib/plugins/'))
		.map((f) => f.slice('src/lib/plugins/'.length))
		.filter((rest) => rest.includes('/'))
		.map((rest) => rest.slice(0, rest.indexOf('/')))
).size;

// A label says what the bucket *does*: the chart's point is the feature surface, not dirs.
const BUCKETS = [
	{ label: 'Block UIs & rendering', dirs: ['components'] },
	{ label: 'Editing, commits & undo', dirs: ['editor-actions', 'tree-operations', 'undo'] },
	{ label: 'Parser, serializer, inline', dirs: ['core'] },
	{ label: 'Selection, caret, markers', dirs: ['selection', 'cursor', 'ambient'] },
	{ label: 'Public API & wiring', dirs: ['.'] },
	{ label: 'Schema & plugin registry', dirs: ['schema'] },
	{ label: `${bundledPluginCount} bundled plugins`, dirs: ['plugins'] },
	{ label: 'Invariants & debug tooling', dirs: ['invariants', 'testing', 'debug', 'perf'] },
	{ label: 'Windowing & reactivity', dirs: ['reactivity'] },
	{ label: 'Decorations & search', dirs: ['decorations', 'search'] }
];

const linesOf = (f) => {
	const body = readFileSync(join(root, f), 'utf8');
	if (body.length === 0) return 0;
	let n = 0;
	for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) n++;
	return body.endsWith('\n') ? n : n + 1;
};

// '.' stands for a file sitting directly in src/lib.
const moduleOf = (f) => {
	const rest = f.slice('src/lib/'.length);
	return rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : '.';
};

const byModule = new Map();
for (const f of files) byModule.set(moduleOf(f), (byModule.get(moduleOf(f)) ?? 0) + linesOf(f));

const data = BUCKETS.map((b) => ({
	label: b.label,
	loc: b.dirs.reduce((n, d) => n + (byModule.get(d) ?? 0), 0)
})).sort((a, b) => b.loc - a.loc);

const total = [...byModule.values()].reduce((a, b) => a + b, 0);
const shown = data.reduce((a, b) => a + b.loc, 0);
console.log(`total ${total} lines across ${files.length} files; ${shown} bucketed`);
for (const d of data) console.log(`  ${String(d.loc).padStart(6)}  ${d.label}`);

// ── Render ───────────────────────────────────────────────────────────────────

const THEMES = {
	light: { ...BASE_THEMES.light, bar: '#2a78d6' },
	dark: { ...BASE_THEMES.dark, bar: '#3987e5' }
};

const W = 880;
const LABEL_W = 236;
const BAR_X = LABEL_W + 12;
const BAR_MAX = 760 - BAR_X;
const ROW_H = 30;
const TOP = 84;
const H = TOP + data.length * ROW_H + 16;
const maxLoc = Math.max(...data.map((d) => d.loc));

const kloc = (v) => `${(v / 1000).toFixed(1)}k`;

function chart(theme) {
	const t = THEMES[theme];
	const p = [];
	const text = textBuilder(t, p);

	p.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Library source by area: ${data.map((d) => `${d.label} ${kloc(d.loc)}`).join(', ')}. About ${kloc(total)} lines total.`)}">`
	);
	p.push(`<rect width="${W}" height="${H}" fill="${t.surface}"/>`);

	text(24, 36, `Where the ${kloc(total)} lines go`, { size: 15, weight: 600, fill: t.inkPrimary });
	text(24, 56, 'shipped library source, tests excluded', { size: 12.5, fill: t.inkSecondary });

	data.forEach((d, i) => {
		const y = TOP + i * ROW_H;
		const w = Math.max(2, (d.loc / maxLoc) * BAR_MAX);
		text(LABEL_W, y + 15, d.label, { size: 12.5, fill: t.inkSecondary, anchor: 'end' });
		p.push(
			`<rect x="${BAR_X}" y="${y + 4}" width="${w.toFixed(1)}" height="18" rx="4" fill="${t.bar}"/>`
		);
		text(BAR_X + w + 8, y + 15, kloc(d.loc), {
			size: 12,
			fill: t.muted,
			extra: ' style="font-variant-numeric:tabular-nums"'
		});
	});

	p.push('</svg>');
	return p.join('\n');
}

const outDir = join(root, 'docs', 'assets');
mkdirSync(outDir, { recursive: true });
for (const theme of ['light', 'dark']) {
	writeFileSync(join(outDir, `loc-${theme}.svg`), chart(theme) + '\n');
}
console.log('wrote 2 SVGs to docs/assets/');
