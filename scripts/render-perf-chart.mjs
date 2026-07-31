// Renders the README performance charts from the committed perf baseline into
// docs/assets/perf-{keystroke,load}-{light,dark}.svg. Zero dependencies and deterministic
// (no timestamps — the recorded date and hardware context live in the README caption), so
// a re-run after a baseline re-bless reproduces the files byte-for-byte.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES as BASE_THEMES, esc, textBuilder } from './chart-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(join(root, 'src/lib/test/perf/baseline.json'), 'utf8'));

// ── Data ─────────────────────────────────────────────────────────────────────

const SIZES = ['100KB', '1MB', '10MB'];

const byShape = new Map();
for (const [key, row] of Object.entries(baseline.e2e)) {
	if (typeof row !== 'object' || !('keystrokeP50Ms' in row)) continue;
	const m = key.match(/^(.*)-(100KB|1MB|10MB)$/);
	if (!m) continue;
	const [, shape, size] = m;
	if (!byShape.has(shape)) byShape.set(shape, {});
	byShape.get(shape)[size] = row;
}

function series(metric, exceptionShape) {
	const others = [...byShape.keys()].filter((s) => s !== exceptionShape);
	const band = SIZES.map((size) => {
		const values = others.map((s) => byShape.get(s)[size][metric]);
		values.sort((a, b) => a - b);
		// Odd counts take the middle sample; a bare `length / 2` would index on a half and
		// yield NaN for every odd series count.
		const mid = values.length >> 1;
		return {
			min: values[0],
			max: values[values.length - 1],
			median: values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
		};
	});
	const exception = SIZES.map((size) => byShape.get(exceptionShape)[size][metric]);
	return { band, exception, otherCount: others.length };
}

// ── Theme tokens (dataviz reference palette) ─────────────────────────────────

// Base palette + this chart's series colors (band/median + the exception line).
const THEMES = {
	light: { ...BASE_THEMES.light, axis: '#c3c2b7', bundle: '#2a78d6', accent: '#eb6834' },
	dark: { ...BASE_THEMES.dark, axis: '#383835', bundle: '#3987e5', accent: '#d95926' }
};

// ── Geometry ─────────────────────────────────────────────────────────────────

const W = 880;
const H = 412;
const PLOT = { left: 64, right: 620, top: 96, bottom: 356 };
const X = SIZES.map(
	(_, i) => PLOT.left + 36 + (i * (PLOT.right - PLOT.left - 72)) / (SIZES.length - 1)
);

function fmtMs(v) {
	if (v >= 10_000) return `${Math.round(v / 1000)} s`;
	if (v >= 1000) return `${(v / 1000).toFixed(1)} s`;
	if (v >= 10) return `${Math.round(v)} ms`;
	return `${v.toFixed(1)} ms`;
}

// ── Chart builder ────────────────────────────────────────────────────────────

function chart(theme, spec) {
	const t = THEMES[theme];
	const { band, exception } = series(spec.metric, spec.exceptionShape);
	const [logMin, logMax] = [Math.log10(spec.yDomain[0]), Math.log10(spec.yDomain[1])];
	const y = (v) =>
		PLOT.bottom - ((Math.log10(v) - logMin) / (logMax - logMin)) * (PLOT.bottom - PLOT.top);

	const parts = [];
	const text = textBuilder(t, parts);

	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria)}">`
	);
	parts.push(`<rect width="${W}" height="${H}" fill="${t.surface}"/>`);

	// Title block + legend
	text(24, 34, spec.title, { size: 15, weight: 600, fill: t.inkPrimary });
	text(24, 54, spec.subtitle, { size: 12.5, fill: t.inkSecondary });
	const legend = [
		[t.bundle, spec.bundleName],
		[t.accent, spec.exceptionName]
	];
	let lx = 24;
	for (const [color, label] of legend) {
		parts.push(`<circle cx="${lx + 4}" cy="${73}" r="4" fill="${color}"/>`);
		text(lx + 13, 77, label, { size: 12, fill: t.inkSecondary });
		lx += 13 + label.length * 6.1 + 26;
	}

	// Gridlines + y ticks
	for (const tick of spec.yTicks) {
		const yy = y(tick);
		parts.push(
			`<line x1="${PLOT.left}" y1="${yy}" x2="${PLOT.right}" y2="${yy}" stroke="${t.grid}" stroke-width="1"/>`
		);
		text(PLOT.left - 8, yy + 4, fmtMs(tick), {
			size: 11.5,
			fill: t.muted,
			anchor: 'end',
			extra: ' style="font-variant-numeric:tabular-nums"'
		});
	}

	// Baseline + x labels
	parts.push(
		`<line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="${t.axis}" stroke-width="1"/>`
	);
	SIZES.forEach((size, i) => {
		parts.push(
			`<line x1="${X[i]}" y1="${PLOT.bottom}" x2="${X[i]}" y2="${PLOT.bottom + 5}" stroke="${t.axis}" stroke-width="1"/>`
		);
		text(X[i], PLOT.bottom + 22, size.replace('KB', ' KB').replace('MB', ' MB'), {
			size: 12,
			fill: t.muted,
			anchor: 'middle'
		});
	});
	text(
		(PLOT.left + PLOT.right) / 2,
		PLOT.bottom + 42,
		'document size (log-spaced) · vertical axis is log scale',
		{
			size: 11.5,
			fill: t.muted,
			anchor: 'middle'
		}
	);

	// Bundle band + median line
	const top = band.map((b, i) => `${X[i]},${y(b.max)}`).join(' ');
	const bot = [...band]
		.reverse()
		.map((b, i) => `${X[band.length - 1 - i]},${y(b.min)}`)
		.join(' ');
	parts.push(`<polygon points="${top} ${bot}" fill="${t.bundle}" opacity="0.16"/>`);
	const medianPts = band.map((b, i) => `${X[i]},${y(b.median)}`).join(' ');
	parts.push(
		`<polyline points="${medianPts}" fill="none" stroke="${t.bundle}" stroke-width="2" stroke-linecap="round"/>`
	);
	band.forEach((b, i) =>
		parts.push(
			`<circle cx="${X[i]}" cy="${y(b.median)}" r="4" fill="${t.bundle}" stroke="${t.surface}" stroke-width="2"/>`
		)
	);

	// Exception line
	const excPts = exception.map((v, i) => `${X[i]},${y(v)}`).join(' ');
	parts.push(
		`<polyline points="${excPts}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-linecap="round"/>`
	);
	exception.forEach((v, i) => {
		parts.push(
			`<circle cx="${X[i]}" cy="${y(v)}" r="4" fill="${t.accent}" stroke="${t.surface}" stroke-width="2"/>`
		);
		text(X[i], y(v) - 12, fmtMs(v), {
			size: 11.5,
			fill: t.inkSecondary,
			anchor: 'middle',
			extra: ' style="font-variant-numeric:tabular-nums"'
		});
	});

	// Direct labels, right gutter — placed top-down, pushed apart on collision
	const gutterEntries = [
		{ y: y(exception[exception.length - 1]), color: t.accent, lines: spec.exceptionLabel },
		{ y: y(band[band.length - 1].median), color: t.bundle, lines: spec.bundleLabel(band) }
	].sort((a, b) => a.y - b.y);
	let nextFreeY = PLOT.top + 10;
	for (const entry of gutterEntries) {
		const yy = Math.max(nextFreeY, Math.min(PLOT.bottom - 10, entry.y));
		nextFreeY = yy + entry.lines.length * 16 + 12;
		parts.push(`<circle cx="${PLOT.right + 16}" cy="${yy - 4}" r="4" fill="${entry.color}"/>`);
		entry.lines.forEach((line, i) =>
			text(PLOT.right + 26, yy + i * 16, line, {
				size: 12.5,
				weight: i === 0 ? 600 : 400,
				fill: i === 0 ? t.inkPrimary : t.inkSecondary
			})
		);
	}

	parts.push('</svg>');
	return parts.join('\n');
}

// ── The two charts ───────────────────────────────────────────────────────────

const keystroke = {
	metric: 'keystrokeP50Ms',
	exceptionShape: 'single-giant-paragraph',
	yDomain: [1, 3000],
	yTicks: [1, 10, 100, 1000],
	title: 'Keystroke latency (p50) vs document size',
	subtitle: 'typing cost stays flat as the document grows, except inside one giant block',
	bundleName: '8 other fixture shapes',
	exceptionName: 'single giant paragraph',
	exceptionLabel: [
		'single giant paragraph',
		'the whole file as one block,',
		'the recorded exception'
	],
	bundleLabel: (band) => {
		const lo = Math.min(...band.map((b) => b.min));
		const hi = Math.max(...band.map((b) => b.max));
		return [
			'8 other fixture shapes',
			`band and median, ${fmtMs(lo)}`,
			`to ${fmtMs(hi)} at every size`
		];
	},
	aria: 'Keystroke p50 latency across nine fixture shapes from 100 kilobytes to 10 megabytes. Eight shapes stay in a flat band of a few milliseconds at every size. A single giant paragraph rises to above a second at 10 megabytes.'
};

const load = {
	metric: 'loadMs',
	exceptionShape: 'many-small-blocks',
	yDomain: [10, 40000],
	yTicks: [10, 100, 1000, 10000],
	title: 'Document load vs document size',
	subtitle: 'materializing the tree is O(document): linear in block count',
	bundleName: '8 other fixture shapes',
	exceptionName: 'many small blocks',
	exceptionLabel: ['many small blocks', '392k blocks at 10 MB,', 'the block count extreme'],
	bundleLabel: (band) => {
		const last = band[band.length - 1];
		return [
			'8 other fixture shapes',
			`band and median,`,
			`${fmtMs(last.min)} to ${fmtMs(last.max)} at 10 MB`
		];
	},
	aria: 'Document load time across nine fixture shapes from 100 kilobytes to 10 megabytes, on a log scale. Load grows roughly linearly with size; every shape loads within a few seconds at 10 megabytes, the 392 thousand block extreme taking the longest.'
};

// ── Emit ─────────────────────────────────────────────────────────────────────

const outDir = join(root, 'docs', 'assets');
mkdirSync(outDir, { recursive: true });
for (const [name, spec] of [
	['perf-keystroke', keystroke],
	['perf-load', load]
]) {
	for (const theme of ['light', 'dark']) {
		const svg = chart(theme, spec);
		if (svg.includes('NaN')) throw new Error(`${name}-${theme}: NaN leaked into geometry`);
		writeFileSync(join(outDir, `${name}-${theme}.svg`), svg + '\n');
	}
}
console.log('wrote 4 SVGs to docs/assets/');
