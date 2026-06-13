import { describe, it, expect } from 'vitest';
import { checkKeymapCoherence } from '$lib/editor/invariants/registry';
import '$lib/editor/schema/block-kind-descriptor';

describe('G1.11 keymap coherence', () => {
	it('passes over the real registries (no kind declares a keymap yet)', () => {
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
});
