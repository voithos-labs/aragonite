// The chord tables written by hand hold the normal form, since the resolvers compare stored
// chords as is and a chord out of modifier order would never match a keypress.
import { describe, it, expect } from 'vitest';
import { GLOBAL_KEYMAP, kindKeymap, reservedUiChords } from '#lib/schema/commands.js';
import { HARDCODED_CHORD_SITES } from '#lib/schema/reserved-chords.js';
import { normalizeChord } from '#lib/schema/keybindings.js';
import { registerBuiltInDescriptors } from '#lib/schema/built-in-descriptors.js';
import { getAllRegisteredKinds } from '#lib/schema/block-kind-descriptor.js';

const denormal = (chords: readonly string[]) => chords.filter((c) => c !== normalizeChord(c));

describe('stored chords are normalized', () => {
	it('the global keymap and the reserved search chords', () => {
		expect(denormal([...GLOBAL_KEYMAP.map((b) => b.chord), ...reservedUiChords()])).toEqual([]);
	});

	it('the hardcoded-chord manifest', () => {
		expect(denormal(HARDCODED_CHORD_SITES.flatMap((site) => site.chords))).toEqual([]);
	});

	it('every registered kind keymap, whole-block defaults included', () => {
		registerBuiltInDescriptors();
		const chords = getAllRegisteredKinds().flatMap((kind) => kindKeymap(kind).map((b) => b.chord));
		expect(chords.length).toBeGreaterThan(20);
		expect(denormal(chords)).toEqual([]);
	});

	it('the check can fail', () => {
		expect(denormal(['Shift+Mod+Z'])).toEqual(['Shift+Mod+Z']);
	});
});
