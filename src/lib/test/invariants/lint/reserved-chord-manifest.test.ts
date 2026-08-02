/**
 * G4.29 — the hardcoded-chord manifest (`schema/reserved-chords.ts`) covers every library
 * file that reads a KeyboardEvent modifier flag, and each entry's key evidence still matches
 * the file. The scan is structural on both axes: a branch cannot claim a chord without
 * reading a modifier flag (file axis) or without comparing a key (evidence axis), so a new
 * claim fails the gate until the manifest names it.
 */
import { describe, it, expect } from 'vitest';
import { HARDCODED_CHORD_SITES } from '$lib/schema/reserved-chords';
import { isChordWellFormed } from '$lib/schema/keybindings';
import { collectEditorSources, EDITOR_SRC, type SourceFile } from './scan-source';

// ── The scan ─────────────────────────────────────────────────────────────────

// `ctrlOrMeta` is the projected flag the table cell's pure plan takes instead of the event.
const MODIFIER_READ = /\.(?:ctrlKey|metaKey|altKey|shiftKey)\b|\bctrlOrMeta\b/;

const KEY_EQUALITY = /\bkey\s*===\s*'([^']*)'/g;
const KEY_PREFIX = /\bkey\.startsWith\('([^']*)'\)/g;
const CASE_LABEL = /\bcase\s*'([^']*)'\s*:/g;

/**
 * Every KeyboardEvent key name is one character or CapitalCamel (UI Events key values), so
 * the filter admits extra non-key strings but can never drop a key — the safe direction for
 * a gate whose failure mode is a silent miss.
 */
function isKeyName(literal: string): boolean {
	return literal.length === 1 || /^[A-Z][A-Za-z0-9]*$/.test(literal);
}

/** Key literals a file compares, `startsWith` prefixes marked with a trailing `*`. */
export function harvestKeys(code: string): string[] {
	const keys = new Set<string>();
	for (const [, literal] of code.matchAll(KEY_EQUALITY)) if (isKeyName(literal)) keys.add(literal);
	for (const [, literal] of code.matchAll(CASE_LABEL)) if (isKeyName(literal)) keys.add(literal);
	for (const [, prefix] of code.matchAll(KEY_PREFIX)) if (isKeyName(prefix)) keys.add(`${prefix}*`);
	return [...keys].sort();
}

// Library-internal by design: the rule binds aragonite's own keydown branches, and a plugin
// or example author's handlers are theirs to publish, not ours to manifest.
const sources: SourceFile[] = collectEditorSources(EDITOR_SRC);
const relToLib = (file: SourceFile) => file.relPath.replace(/^src\/lib\//, '');
const modifierReaders = sources.filter((file) => MODIFIER_READ.test(file.code));
const byPath = new Map(sources.map((file) => [relToLib(file), file]));

// ── The gate ─────────────────────────────────────────────────────────────────

describe('G4.29 hardcoded-chord manifest ↔ library keydown sites', () => {
	it('names every file that reads a modifier flag', () => {
		const manifested = new Set(HARDCODED_CHORD_SITES.map((site) => site.file));
		const unnamed = modifierReaders.map(relToLib).filter((path) => !manifested.has(path));
		expect(
			unnamed,
			`these files read a KeyboardEvent modifier flag but are absent from HARDCODED_CHORD_SITES — add an entry naming the chords each claims (or none, with the reason): ${unnamed.join(', ')}`
		).toEqual([]);
	});

	it('holds no entry for a file that stopped reading modifiers', () => {
		const live = new Set(modifierReaders.map(relToLib));
		const stale = HARDCODED_CHORD_SITES.map((site) => site.file).filter((path) => !live.has(path));
		expect(stale, `stale manifest entries: ${stale.join(', ')}`).toEqual([]);
	});

	it.each(HARDCODED_CHORD_SITES)('$file: key evidence matches the source', (site) => {
		const file = byPath.get(site.file);
		expect(file, `${site.file} does not exist`).toBeDefined();
		expect(
			harvestKeys(file!.code),
			`${site.file} compares a different key set than the manifest records — re-derive its chords, then update \`keys\``
		).toEqual([...site.keys].sort());
	});

	it.each(HARDCODED_CHORD_SITES)('$file: every claimed chord is evidenced', (site) => {
		for (const chord of site.chords) {
			expect(isChordWellFormed(chord), `${site.file}: malformed chord "${chord}"`).toBe(true);
			const key = chord.split('+').pop()!;
			const evidenced = site.keys.some(
				(recorded) =>
					recorded === key ||
					recorded.toLowerCase() === key.toLowerCase() ||
					(recorded.endsWith('*') && key.startsWith(recorded.slice(0, -1)))
			);
			expect(evidenced, `${site.file}: "${chord}" names a key the file never compares`).toBe(true);
		}
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// An over-escaped pattern that matches nothing lets every assertion above pass on an
// empty set, which is the failure this rule exists to prevent.

describe('G4.29 scan non-vacuity', () => {
	it('finds the modifier readers it is meant to find', () => {
		const found = modifierReaders.map(relToLib);
		expect(found.length).toBeGreaterThan(10);
		expect(found).toContain('selection/cross-block/keydown.ts');
		expect(found).toContain('editor-actions/container-block-component.ts');
		expect(found).toContain('components/blocks/table/TableBlock.svelte');
		// A .svelte file must survive collection, or every component site goes unscanned.
		expect(found.some((path) => path.endsWith('.svelte'))).toBe(true);
	});

	it('rejects a file that reads no modifier flag', () => {
		expect(MODIFIER_READ.test('const chord = eventToChord(e);')).toBe(false);
		expect(MODIFIER_READ.test('if (e.shiftKey) return;')).toBe(true);
		expect(MODIFIER_READ.test('if (e.ctrlOrMeta) return;')).toBe(true);
	});

	it('harvests each key-comparison shape and drops non-key literals', () => {
		expect(
			harvestKeys(`
				if (e.key === 'ArrowUp') {}
				switch (e.key) { case 'F10': break; }
				if (e.key.startsWith('Arrow')) {}
				if (key === 'a') {}
				switch (plan.kind) { case 'select-all-step': break; }
			`)
		).toEqual(['Arrow*', 'ArrowUp', 'F10', 'a']);
	});

	it('the evidence assertion can fail', () => {
		const site = HARDCODED_CHORD_SITES.find((s) => s.file === 'schema/keybindings.ts')!;
		expect(harvestKeys(byPath.get(site.file)!.code)).not.toContain('ArrowUp');
	});
});
