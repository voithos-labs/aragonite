/**
 * The consumer guide's § Which shortcuts the editor consumes pastes a sample of
 * `reservedChords()` and then makes a claim about what the set never holds. Both are contracts a
 * host builds its accelerator map on, and neither is inside the shortcut table, so the chord
 * lint next door never reads them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import { collectReservedChords } from '$lib/schema/reserved-chords';

registerBuiltInDescriptors();

function consumedSection(): string {
	const guide = readFileSync(path.resolve('docs/guide/consumer-guide.md'), 'utf8');
	return guide.split('### Which shortcuts the editor consumes')[1]?.split('\n## ')[0] ?? '';
}

/** The chords the pasted `Set { … }` sample names; its trailing `...` is the rest of the set. */
function sampledChords(section: string): string[] {
	const sample = /\/\/ Set \{([^}]*)\}/.exec(section)?.[1] ?? '';
	return [...sample.matchAll(/'([^']+)'/g)].map(([, chord]) => chord);
}

/** The bare keys the "modifier chords only" paragraph names as never appearing. */
function bareKeysClaimed(section: string): string[] {
	const sentence = /Bare keys \(([^)]*)\)/.exec(section)?.[1] ?? '';
	return [...sentence.matchAll(/`([^`]+)`/g)].map(([, key]) => key);
}

const section = consumedSection();
const sampled = sampledChords(section);
const bareKeys = bareKeysClaimed(section);
const reserved = collectReservedChords({ searchBar: true });

describe('consumer-guide § Which shortcuts the editor consumes ↔ reservedChords()', () => {
	it('every chord the pasted sample names is in the live set', () => {
		const absent = sampled.filter((chord) => !reserved.has(chord));
		expect(
			absent,
			`the sample names chords the editor no longer reserves: ${absent.join(', ')}`
		).toEqual([]);
	});

	it('the set holds modifier chords only, as the section promises', () => {
		const bare = [...reserved].filter((chord) => !chord.includes('+'));
		expect(
			bare,
			`these reach the set with no modifier, against the section's claim: ${bare.join(', ')}`
		).toEqual([]);
		for (const key of bareKeys) expect(reserved.has(key), `${key} is reserved`).toBe(false);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// An empty sample, an empty claim or an empty live set lets both assertions pass on nothing.

describe('reserved-set readers — self-tests', () => {
	it('reads a real sample, a real claim and a real set', () => {
		expect(section).not.toBe('');
		expect(sampled.length).toBeGreaterThan(8);
		expect(sampled).toContain('Mod+F');
		expect(bareKeys).toContain('Enter');
		expect(reserved.size).toBeGreaterThan(sampled.length);
	});

	it('reads the sample as a sample, not as the whole set', () => {
		expect(section).toContain('...');
		expect([...reserved].some((chord) => !sampled.includes(chord))).toBe(true);
	});

	it('the readers find nothing in a section that says neither thing', () => {
		expect(sampledChords('Prose with a `Mod+B` in it.')).toEqual([]);
		expect(bareKeysClaimed('Prose with a `Mod+B` in it.')).toEqual([]);
	});
});
