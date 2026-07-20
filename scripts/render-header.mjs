// Renders the README header: an aragonite crystal drawn as vector geometry.
//
//   node scripts/render-header.mjs
//
// Emits docs/assets/aragonite-header.png. Fonts are vendored under
// scripts/fonts (both SIL OFL) so the render is reproducible on any machine.
//
// The subject is aragonite's sputnik habit: hexagonal prisms radiating from a
// dense nucleus. Every ray is placed by hand below — the uneven angles and the
// two dominant spars are the difference between a mineral and a snowflake.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(root, 'scripts', 'fonts');
const outDir = join(root, 'docs', 'assets');

const W = 1600;
const H = 420;
const CX = 330; // nucleus, left-weighted so the wordmark owns the right
const CY = 208;

// ── Palette ──────────────────────────────────────────────────────────────────

// Coral terracotta, read off specimen photography: pale peach terminations
// where light passes through, rust deepening toward the nucleus.
// [capLight, capDeep, bodyOuter, bodyMid, bodyInner]
const TONES = [
	['#f2b988', '#d98e55', '#e08a4e', '#c26834', '#8a421e'],
	['#eeae76', '#cf8046', '#d67c42', '#b25c2c', '#7d3a1a'],
	['#f6c99c', '#e29d63', '#e8975b', '#cb733c', '#944922'],
	['#e8a468', '#c47540', '#cc7038', '#a55326', '#733616'],
	['#f9d4a8', '#eaa96f', '#eda264', '#d37f44', '#9d4f26']
];

// ── Geometry ─────────────────────────────────────────────────────────────────

// { a: angle°, r0: start radius, len: length, w: half-width, t: tone }
const RAYS = [
	{ a: 209, r0: 16, len: 196, w: 28, t: 2 },
	{ a: 226, r0: 14, len: 108, w: 20, t: 3 },
	{ a: 247, r0: 12, len: 128, w: 21, t: 0 },
	{ a: 266, r0: 12, len: 86, w: 17, t: 1 },
	{ a: 296, r0: 12, len: 116, w: 19, t: 4 },
	{ a: 316, r0: 12, len: 84, w: 17, t: 1 },
	{ a: 339, r0: 14, len: 146, w: 22, t: 0 },
	{ a: 357, r0: 13, len: 96, w: 18, t: 3 },
	{ a: 11, r0: 16, len: 178, w: 26, t: 2 },
	{ a: 29, r0: 13, len: 102, w: 19, t: 1 },
	{ a: 52, r0: 12, len: 126, w: 20, t: 4 },
	{ a: 87, r0: 12, len: 78, w: 16, t: 3 },
	{ a: 118, r0: 12, len: 112, w: 19, t: 0 },
	{ a: 143, r0: 13, len: 88, w: 17, t: 4 },
	{ a: 161, r0: 14, len: 148, w: 22, t: 1 },
	{ a: 184, r0: 12, len: 96, w: 18, t: 3 }
];

// Short crystals facing the viewer, packed into the nucleus.
const STUBS = [
	{ a: 252, r0: 4, len: 26, w: 20, t: 3 },
	{ a: 320, r0: 4, len: 22, w: 17, t: 1 },
	{ a: 24, r0: 5, len: 28, w: 21, t: 3 },
	{ a: 98, r0: 4, len: 22, w: 18, t: 1 },
	{ a: 174, r0: 4, len: 26, w: 19, t: 3 },
	{ a: 288, r0: 2, len: 14, w: 15, t: 3 }
];

// ── Drawing ──────────────────────────────────────────────────────────────────

let defs = '';
let gradientId = 0;

const rad = (deg) => (deg * Math.PI) / 180;

function bodyGradient(tone, x1, y1, x2, y2) {
	const id = `body${gradientId++}`;
	const [, , outer, mid, inner] = TONES[tone];
	defs +=
		`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}">` +
		`<stop offset="0" stop-color="${inner}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${outer}"/></linearGradient>`;
	return `url(#${id})`;
}

function capGradient(tone, cx, cy, r) {
	const id = `cap${gradientId++}`;
	const [light, deep] = TONES[tone];
	defs +=
		`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${(cx - r * 0.3).toFixed(1)}" cy="${(cy - r * 0.3).toFixed(1)}" r="${(r * 2).toFixed(1)}">` +
		`<stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${deep}"/></radialGradient>`;
	return `url(#${id})`;
}

function hexagon(cx, cy, r, rotation) {
	return Array.from({ length: 6 }, (_, i) => {
		const a = rotation + rad(60 * i);
		return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
	}).join(' ');
}

function ray({ a, r0, len, w, t }) {
	const theta = rad(a);
	const [ux, uy] = [Math.cos(theta), Math.sin(theta)];
	const [px, py] = [-uy, ux]; // perpendicular, for the prism's width
	const [sx, sy] = [CX + ux * r0, CY + uy * r0];
	const [ex, ey] = [CX + ux * (r0 + len), CY + uy * (r0 + len)];
	const w0 = w * 0.72; // prisms taper slightly toward the nucleus
	const at = (x, y, s) => `${(x + px * s).toFixed(1)},${(y + py * s).toFixed(1)}`;

	let out = `<polygon points="${at(sx, sy, w0)} ${at(ex, ey, w)} ${at(ex, ey, -w)} ${at(sx, sy, -w0)}" fill="${bodyGradient(t, sx, sy, ex, ey)}"/>`;
	// Shaded flank, so a prism reads as round rather than flat.
	out += `<polygon points="${at(sx, sy, -w0)} ${at(ex, ey, -w)} ${at(ex, ey, -w * 0.45)} ${at(sx, sy, -w0 * 0.45)}" fill="rgba(58,22,6,0.16)"/>`;
	for (const f of [-0.35, 0.1, 0.5]) {
		out += `<line x1="${at(sx, sy, w0 * f).replace(',', '" y1="')}" x2="${at(ex, ey, w * f).replace(',', '" y2="')}" stroke="rgba(255,235,214,0.07)" stroke-width="1"/>`;
	}

	const capR = w * 1.06;
	out += `<polygon points="${hexagon(ex, ey, capR, theta)}" fill="${capGradient(t, ex, ey, capR)}" stroke="rgba(110,46,16,0.4)" stroke-width="0.8"/>`;
	out += `<polygon points="${hexagon(ex, ey, capR * 0.6, theta)}" fill="none" stroke="rgba(255,238,216,0.16)" stroke-width="0.8"/>`;
	return out;
}

const crystals = [...RAYS, ...STUBS].map(ray).join('\n');

// Applied over the rays: the crevices between prisms sit in shadow.
defs +=
	`<radialGradient id="nucleus" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="58">` +
	`<stop offset="0" stop-color="rgba(32,13,3,0.4)"/><stop offset="0.55" stop-color="rgba(32,13,3,0.18)"/>` +
	`<stop offset="1" stop-color="rgba(32,13,3,0)"/></radialGradient>`;

const svg = `<svg id="plate" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
${defs}
<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
	<stop offset="0" stop-color="#3a2718" stop-opacity="0.9"/>
	<stop offset="0.55" stop-color="#2a1d12" stop-opacity="0.5"/>
	<stop offset="1" stop-color="#2a1d12" stop-opacity="0"/>
</radialGradient>
</defs>

<rect width="${W}" height="${H}" fill="#131312"/>
<ellipse cx="${CX}" cy="${CY}" rx="470" ry="290" fill="url(#halo)"/>

${crystals}
<circle cx="${CX}" cy="${CY}" r="58" fill="url(#nucleus)"/>

<text x="620" y="232" font-family="Poiret One" font-size="102" letter-spacing="7" fill="#ece7dd">aragonite</text>
<text x="626" y="280" font-family="DM Mono" font-size="14" letter-spacing="4.5" fill="#96917f">A LOSSLESS MARKDOWN BLOCK EDITOR</text>
</svg>`;

// ── Render ───────────────────────────────────────────────────────────────────

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Poiret One'; src: url('file:///${join(fontDir, 'PoiretOne-Regular.ttf').replace(/\\/g, '/')}'); }
@font-face { font-family: 'DM Mono'; src: url('file:///${join(fontDir, 'DMMono-Regular.ttf').replace(/\\/g, '/')}'); }
body { margin: 0; background: #000; }
</style></head><body>${svg}</body></html>`;

mkdirSync(outDir, { recursive: true });
const scratchHtml = join(outDir, '.header-render.html');
writeFileSync(scratchHtml, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.goto(`file:///${scratchHtml.replace(/\\/g, '/')}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.locator('#plate').screenshot({ path: join(outDir, 'aragonite-header.png') });
await browser.close();

const { unlinkSync } = await import('node:fs');
unlinkSync(scratchHtml);
console.log('wrote docs/assets/aragonite-header.png');
