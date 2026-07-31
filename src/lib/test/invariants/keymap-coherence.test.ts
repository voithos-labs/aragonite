import { describe, it, expect } from 'vitest';
import { checkKeymapCoherence } from '$lib/invariants/registry';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { GLOBAL_COMMAND_IDS, BLOCK_COMMAND_IDS } from '$lib/schema/commands';
import { normalizeChord, isChordWellFormed } from '$lib/schema/keybindings';

const knownCommands = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);
const isKnown = (id: string) => knownCommands.has(id);

const check = (entries: Parameters<typeof checkKeymapCoherence>[0]) =>
	checkKeymapCoherence(entries, isKnown, normalizeChord, isChordWellFormed);

describe('G1.11 keymap coherence', () => {
	it('passes over the real registries (the declared keymaps are coherent)', () => {
		const entries = ALL_BLOCK_KINDS.map((kind) => ({
			kind,
			keymap: tryGetBlockKindDescriptor(kind)?.keymap
		}));
		expect(check(entries)).toBeNull();
	});

	it('flags a keymap binding to an unknown command', () => {
		const v = check([
			{ kind: 'paragraph', keymap: [{ chord: 'Mod+B', command: 'no.such.command' }] }
		]);
		expect(v?.code).toBe('keymap-coherence');
	});

	// Without a well-formedness arm `Ctrl+W` collapses to a bare `W` under normalizeChord:
	// valid, unique, known-command, and firing on every plain `w`.
	it('flags a descriptor chord with an unrecognized modifier (the Ctrl+W trap)', () => {
		const v = check([{ kind: 'paragraph', keymap: [{ chord: 'Ctrl+W', command: 'block.split' }] }]);
		expect(v?.code).toBe('keymap-coherence');
		expect((v?.detail as { issue?: string }).issue).toBe('malformed');
	});

	it('flags a descriptor chord with an empty key', () => {
		const v = check([{ kind: 'paragraph', keymap: [{ chord: 'Mod+', command: 'block.split' }] }]);
		expect(v?.code).toBe('keymap-coherence');
		expect(v?.detail).toMatchObject({ issue: 'malformed' });
	});

	it('flags duplicate chords within one kind', () => {
		const v = check([
			{
				kind: 'paragraph',
				keymap: [
					{ chord: 'Mod+B', command: 'format.toggleStrong' },
					{ chord: 'Mod+B', command: 'format.toggleEmphasis' }
				]
			}
		]);
		expect(v?.code).toBe('keymap-coherence');
	});

	it('accepts a valid keymap', () => {
		expect(
			check([{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] }])
		).toBeNull();
	});

	// Two kinds binding the same chord is legal, so a seen-set hoisted above the per-kind
	// loop would false-positive here.
	it('allows two different kinds to bind the same chord', () => {
		expect(
			check([
				{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] },
				{ kind: 'fencedCode', keymap: [{ chord: 'Enter', command: 'code.newline' }] }
			])
		).toBeNull();
	});
});
