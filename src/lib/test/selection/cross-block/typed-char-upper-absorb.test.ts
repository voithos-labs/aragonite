// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers, selectAcross, makeBeforeInputEvent } from './typed-char-env';

// A typed character demoting the survivor merges it upward; the caret must follow the bytes there.
// Miss-analysis: GH #21; this path's cases asserted kind and bytes, never where the caret went.

describe('cross-block typed character: a fold above the survivor', () => {
	it('lands the caret in the block the fold left standing', async () => {
		const env = makeEnv('a\n# h\n\n# kkk\n');
		const paths: number[][] = [];
		const offsets: (number | undefined)[] = [];
		// A single text node is the whole block, so DOM and raw offsets agree. jsdom's focus resets
		// the selection, so the caret is read at the focus call, where production reads it too.
		const blockEl = document.createElement('div');
		blockEl.append(document.createTextNode('a\nx# kkk\n'));
		blockEl.focus = () => offsets.push(window.getSelection()?.anchorOffset);
		document.body.appendChild(blockEl);

		// Whole of the first heading, up to the second's start: the delete leaves `# kkk` behind
		// with the paragraph still tight above it.
		selectAcross(env.selectionState, [1], [2]);
		const handlers = makeHandlers(env, [1], {
			getBlockElByPath: (path) => {
				paths.push(path.slice());
				return blockEl;
			}
		});

		await handlers.handleBeforeInput(makeBeforeInputEvent('x'));

		expect(serialize(env.doc)).toBe('a\nx# kkk\n');
		expect(env.doc.children).toHaveLength(1);
		expect(paths.at(-1)).toEqual([0]);
		expect(offsets.at(-1)).toBe(3);
	});
});
