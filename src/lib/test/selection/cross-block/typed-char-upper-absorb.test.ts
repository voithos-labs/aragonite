// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers, selectAcross, makeBeforeInputEvent } from './typed-char-env';

// GH #21's caret half at the cross-block door: the typed character demotes the survivor, the
// settle absorbs the paragraph above it, and the caret has to follow the bytes into the
// predecessor's slot instead of addressing the one the fold emptied.
// Miss-analysis: this door's pins asserted the survivor's kind and bytes, never the path and
// offset it hands the caret, so a landing aimed at a vacated slot could not fail.

describe('cross-block typed character — a fold above the survivor', () => {
	it('lands the caret in the block the fold left standing', async () => {
		const env = makeEnv('a\n# h\n\n# kkk\n');
		const paths: number[][] = [];
		const offsets: (number | undefined)[] = [];
		// A single text node is the whole block: no ambient marker, so DOM and raw offsets agree.
		// The door places the range and then focuses, and jsdom's own focus resets the selection —
		// so the landing is read at the focus call, which is where production reads it too.
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
