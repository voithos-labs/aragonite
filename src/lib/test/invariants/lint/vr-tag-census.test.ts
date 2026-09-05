/**
 * G4.59 — the VR tag catalog (`docs/design/virtual-rendering.md`) and the tags cited under `src/`
 * are one set, both directions. Scanned over RAW text, comments included: a citation is almost
 * always a comment, so the house comment-stripping lexer would erase the population it counts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CATALOG = 'docs/design/virtual-rendering.md';

/** Excluded from the citation set: this file's fixtures name tags the catalog must not carry. */
const SELF = 'src/lib/test/invariants/lint/vr-tag-census.test.ts';

/** Tags are cited from windowing code, styles, unit tests and e2e requirement files alike. */
const CITING_EXTENSIONS = ['.ts', '.svelte', '.css', '.md'];

const TAG = /\bVR-[A-Z0-9]+\b/g;

// ── The citations ────────────────────────────────────────────────────────────

function citingFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) citingFiles(full, out);
		else if (CITING_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			out.push(path.relative(ROOT, full).split(path.sep).join('/'));
		}
	}
	return out;
}

/** Each cited tag, mapped to the files citing it, so a failure names somewhere to look. */
function citations(relPaths: string[]): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const rel of relPaths) {
		for (const [tag] of readFileSync(path.join(ROOT, rel), 'utf8').matchAll(TAG)) {
			found.set(tag, [...(found.get(tag) ?? []), rel]);
		}
	}
	return found;
}

/** Stops at `src/`: the catalog's own prose names its retired numbers (VR-7, VR-10, VR-13). */
const scanned = citingFiles(path.join(ROOT, 'src'));
const cited = citations(scanned.filter((rel) => rel !== SELF));

// ── The catalog ──────────────────────────────────────────────────────────────

/** A row is a table line whose first cell is a bare tag, so the hazard column stays rewritable. */
function catalogTags(markdown: string): string[] {
	const tags: string[] = [];
	for (const line of markdown.split('\n')) {
		if (!line.trimStart().startsWith('|')) continue;
		const first = (line.split('|')[1] ?? '').trim();
		if (/^VR-[A-Z0-9]+$/.test(first)) tags.push(first);
	}
	return tags;
}

const catalogued = catalogTags(readFileSync(path.join(ROOT, CATALOG), 'utf8'));

// ── The gate ─────────────────────────────────────────────────────────────────

describe('G4.59 VR tag catalog ↔ its citations', () => {
	it('catalogues every tag cited under src/', () => {
		const uncatalogued = [...cited.keys()].filter((tag) => !catalogued.includes(tag)).sort();
		expect(
			uncatalogued,
			`cited with no row in ${CATALOG} — add one saying what the hazard is and what stays true: ${uncatalogued
				.map((tag) => `${tag} (${cited.get(tag)?.[0]})`)
				.join(', ')}`
		).toEqual([]);
	});

	it('holds no row nothing cites', () => {
		const orphaned = catalogued.filter((tag) => !cited.has(tag));
		expect(
			orphaned,
			`catalogued but cited nowhere — the catalog says to delete such a row: ${orphaned.join(', ')}`
		).toEqual([]);
	});

	it('lists each tag once', () => {
		const duplicated = catalogued.filter((tag, i) => catalogued.indexOf(tag) !== i);
		expect(duplicated, `duplicated rows: ${duplicated.join(', ')}`).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// An empty corpus or an empty catalog lets both directions pass on nothing, which is the
// failure this census exists to prevent.

describe('G4.59 scan non-vacuity', () => {
	it('reaches every file kind a tag is cited from', () => {
		for (const ext of CITING_EXTENSIONS) {
			expect(
				scanned.filter((rel) => rel.endsWith(ext)).length,
				`no ${ext} file scanned`
			).toBeGreaterThan(0);
		}
		expect(scanned.length).toBeGreaterThan(500);
	});

	it('reads its own path, so the self-exclusion matches something', () => {
		expect(scanned).toContain(SELF);
		expect(cited.has('VR-99')).toBe(false);
	});

	it('matches a tag in a comment, a citation in parentheses and a table cell alike', () => {
		expect(
			[...'// pins VR-5, and (VR-K1)\n| VR-99 | row |'.matchAll(TAG)].map(([tag]) => tag)
		).toEqual(['VR-5', 'VR-K1', 'VR-99']);
	});

	it('reads the tag column and drops the header, rule and prose', () => {
		expect(
			catalogTags(
				[
					'| Tag | The hazard, and what stays true |',
					'| --- | --- |',
					'| VR-1 | narrower editor rewraps prose |',
					'| VR-K1 | index 0 is the first mounted row |',
					'The numbering already skips VR-7.'
				].join('\n')
			)
		).toEqual(['VR-1', 'VR-K1']);
	});

	it('both directions can fail', () => {
		expect(catalogTags('| VR-1 | one row |')).toEqual(['VR-1']);
		expect([...cited.keys()].filter((tag) => tag !== 'VR-1').length).toBeGreaterThan(0);
		expect(['VR-99'].filter((tag) => !cited.has(tag))).toEqual(['VR-99']);
	});
});
