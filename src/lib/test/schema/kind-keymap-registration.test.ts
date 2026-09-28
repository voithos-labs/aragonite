// A kind's keymap chords are checked when the kind registers, in every build, so a mistyped
// `Ctrl+B` never collapses to a bare `B` that fires on each plain keypress.
// Miss-analysis: no test registered a malformed chord and read the stored keymap.
import { describe, it, expect } from 'vitest';
import { augmentBlockKind } from '$lib/plugin';
import { resolveBinding } from '$lib/schema/commands';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { testLeaf } from '../harness/test-kinds';

const MALFORMED = ['Ctrl+B', 'Mod+', 'Cmd+Shift+K'];

describe('a malformed kind keymap chord', () => {
	it.each(MALFORMED)('%s throws at registerBlockKind', (chord) => {
		expect(() =>
			testLeaf('spec-malformed-chord', { keymap: [{ chord, command: 'format.toggleStrong' }] })
		).toThrow(/malformed/);
	});

	it.each(MALFORMED)('%s throws at augmentBlockKind', (chord) => {
		const kind = testLeaf('spec-augmented-chord');

		expect(() =>
			augmentBlockKind(kind, { keymap: [{ chord, command: 'format.toggleStrong' }] })
		).toThrow(/malformed/);
	});

	it('a well-formed keymap registers', () => {
		expect(() =>
			testLeaf('spec-good-chord', { keymap: [{ chord: 'Mod+B', command: 'format.toggleStrong' }] })
		).not.toThrow();
	});

	// The resolvers compare stored chords without normalizing, so registration must store the
	// normal form or a chord declared out of modifier order would never match a keypress.
	it.each(['register', 'augment'])('a chord declared out of order binds at %s', (entry) => {
		const keymap = [{ chord: 'Shift+Mod+b', command: 'format.toggleStrong' as const }];
		const kind =
			entry === 'register' ? testLeaf('spec-order', { keymap }) : testLeaf('spec-order-aug');
		if (entry === 'augment') augmentBlockKind(kind, { keymap });

		expect(resolveBinding('Mod+Shift+B', kind, undefined, everyInstalledPlugin)?.command).toBe(
			'format.toggleStrong'
		);
	});
});
