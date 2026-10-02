// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers, makePasteEvent, selectAcross } from './typed-char-env';

// A paste that demotes the survivor merges the block above in, so the caret lands in that block.
// Miss-analysis: GH #21; the fixed-up caret was tested at the primitive only, never at the paste.

describe('cross-block paste: a fold above the pasted bytes', () => {
	it('lands the caret after the pasted byte, in the block the fold merged it into', async () => {
		const env = makeEnv('a\n# h\n\n# kkk\n');
		const handlers = makeHandlers(env, [1]);

		selectAcross(env.selectionState, [1], [2]);
		await handlers.handlePaste(makePasteEvent('x'));

		expect(serialize(env.doc)).toBe('a\nx# kkk\n');
		expect(env.doc.children).toHaveLength(1);
		// Offset 3 is the byte after the pasted `x` in the merged block (`'a\n'` + 1).
		const landed = env.landings.at(-1);
		expect(landed && [[...landed.leafPath], landed.offset]).toEqual([[0], 3]);
	});
});
