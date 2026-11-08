// The committed word data is exactly what the generator writes from the vendored SCOWL files, so a
// hand edit or a half-finished regeneration can't ship.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
	SPELL_DATA_PATH,
	readVendoredDictionary,
	renderSpellData
} from '../../../../../scripts/vendor/generate-spell-dictionary.mjs';

/** Where two texts first differ, with a little of each, or null when they match. */
function firstDifference(a: string, b: string): string | null {
	if (a === b) return null;
	let at = 0;
	while (at < a.length && a[at] === b[at]) at++;
	return `at ${at}: ${JSON.stringify(a.slice(at, at + 40))} vs ${JSON.stringify(b.slice(at, at + 40))}`;
}

describe('the spellcheck word data', () => {
	it('is the generator’s output over the vendored files', async () => {
		const { aff, dic } = await readVendoredDictionary();
		const committed = await readFile(SPELL_DATA_PATH, 'utf8');
		expect(firstDifference(committed, renderSpellData(aff, dic))).toBeNull();
	});

	it('opens with the legal comment a bundler keeps in a host’s build', async () => {
		const committed = await readFile(SPELL_DATA_PATH, 'utf8');
		expect(committed.startsWith('/*! ')).toBe(true);
		expect(committed.slice(0, 400)).toContain('Kevin Atkinson');
	});
});
