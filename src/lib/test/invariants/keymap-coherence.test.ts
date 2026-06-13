import { describe, it, expect } from 'vitest';
import { checkKeymapCoherence } from '$lib/editor/invariants/registry';
import '$lib/editor/schema/block-kind-descriptor';

describe('G1.11 keymap coherence', () => {
	it('passes over the real registries (the declared keymaps are coherent)', () => {
		expect(checkKeymapCoherence()).toBeNull();
	});
	it('flags a keymap binding to an unknown command', () => {
		const v = checkKeymapCoherence([
			{ kind: 'paragraph', keymap: [{ chord: 'Mod+B', command: 'no.such.command' as never }] }
		]);
		expect(v?.code).toBe('keymap-coherence');
	});
	it('flags duplicate chords within one kind', () => {
		const v = checkKeymapCoherence([
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
			checkKeymapCoherence([
				{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] }
			])
		).toBeNull();
	});
	// Guards the per-kind chord scoping: the dup check resets per kind, so two
	// kinds binding the same chord is legal. Would false-positive if the seen-set
	// were hoisted above the per-kind loop (the exact regression IMPL-3+ exposes).
	it('allows two different kinds to bind the same chord', () => {
		expect(
			checkKeymapCoherence([
				{ kind: 'paragraph', keymap: [{ chord: 'Enter', command: 'block.split' }] },
				{ kind: 'fencedCode', keymap: [{ chord: 'Enter', command: 'code.newline' }] }
			])
		).toBeNull();
	});
});
