// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { makeEnv, makeHandlers, selectAcross, makeBeforeInputEvent } from './typed-char-env';

// A typed character demoting the survivor merges it upward; the caret must follow the bytes there.
// Miss-analysis: GH #21; this path's cases asserted kind and bytes, never where the caret went.

describe('cross-block typed character: a fold above the survivor', () => {
	it('lands the caret in the block the fold left standing', async () => {
		const env = makeEnv('a\n# h\n\nkkk\n');

		// The heading and the paragraph's first `k`: the delete leaves `kk` where the heading was,
		// tight under the paragraph above, which reads it as its own next line.
		selectAcross(env.selectionState, [1], [2], 1);
		await makeHandlers(env, [1]).handleBeforeInput(makeBeforeInputEvent('x'));

		expect(serialize(env.doc)).toBe('a\nxkk\n');
		expect(env.doc.children).toHaveLength(1);
		// Offset 3 is the byte after the typed `x` in the merged block (`'a\n'` + 1).
		const landed = env.landings.at(-1);
		expect(landed && [[...landed.leafPath], landed.offset]).toEqual([[0], 3]);
	});
});
