import { describe, it, expect } from 'vitest';
import { checkKeymapCoherence } from '$lib/invariants/registry';
import { ALL_BLOCK_KINDS } from '$lib/core/nodes';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { GLOBAL_COMMAND_IDS, BLOCK_COMMAND_IDS } from '$lib/schema/commands';
import { normalizeChord } from '$lib/schema/keybindings';

const knownCommands = new Set<string>([...GLOBAL_COMMAND_IDS, ...BLOCK_COMMAND_IDS]);
const isKnown = (id: string) => knownCommands.has(id);

describe('G1.11 keymap coherence', () => {
	it('passes over the real registries (the declared keymaps are coherent)', () => {
		const entries = ALL_BLOCK_KINDS.map((kind) => ({
			kind,
			keymap: tryGetBlockKindDescriptor(kind)?.keymap
		}));
		expect(checkKeymapCoherence(entries, isKnown, normalizeChord)).toBeNull();
	});
	it('flags a keymap binding to an unknown command', () => {
		const v = checkKeymapCoherence(
			[{ kind: 'paragraph', keymap: [{ chord: 'Mod+B', command: 'no.such.command' }] }],
			isKnown,
			normalizeChord
		);
		expect(v?.code).toBe('keymap-coherence');
	});
	it('flags duplicate chords within one kind', () => {
		const v = checkKeymapCoherence(
			[
				{
					kind: 'paragraph',
					keymap: [
						{ chord: 'Mod+B', command: 'format.toggleStrong' },
						{ chord: 'Mod+B', command: 'format.toggleEmphasis' }
					]
				}
			],
			isKnown,
			normalizeChord
		);
		expect(v?.code).toBe('keymap-coherence');
	});
	it('accepts a valid keymap', () => {
		expect(
			checkKeymapCoherence(
				[{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] }],
				isKnown,
				normalizeChord
			)
		).toBeNull();
	});
	// Guards the per-kind chord scoping: the dup check resets per kind, so two
	// kinds binding the same chord is legal. Would false-positive if the seen-set
	// were hoisted above the per-kind loop (the exact regression IMPL-3+ exposes).
	it('allows two different kinds to bind the same chord', () => {
		expect(
			checkKeymapCoherence(
				[
					{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] },
					{ kind: 'fencedCode', keymap: [{ chord: 'Enter', command: 'code.newline' }] }
				],
				isKnown,
				normalizeChord
			)
		).toBeNull();
	});
});
