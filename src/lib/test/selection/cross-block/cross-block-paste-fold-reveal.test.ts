// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers, makePasteEvent, selectAcross } from './typed-char-env';

// A paste that demotes the survivor merges the block above in, so the paste must mount that spot.
// Miss-analysis: GH #21; the fixed-up caret was tested at the primitive only, never at the paste.

/** The render window as the paste sees it: a position answers an element only once mounted. */
function makeWindowedEnv() {
	const env = makeEnv('a\n# h\n\n# kkk\n');
	const revealed = new Set<string>();
	const offsets: (number | undefined)[] = [];
	const blockEl = document.createElement('div');
	blockEl.append(document.createTextNode('a\nx# kkk\n'));
	blockEl.focus = () => offsets.push(window.getSelection()?.anchorOffset);
	document.body.appendChild(blockEl);

	// Only the merged block's position is windowed out here, until the gesture mounts it.
	const handlers = makeHandlers(env, [1], {
		getBlockElByPath: (path) => (revealed.has(path.join(',')) ? blockEl : null),
		revealPath: async (path: number[]) => {
			revealed.add(path.join(','));
			return env.deps.caretLanding.mount(path);
		}
	});
	return { env, handlers, offsets };
}

describe('cross-block paste: a fold above the pasted bytes', () => {
	it('reveals the slot the fold landed on before reading it for an element', async () => {
		const { env, handlers, offsets } = makeWindowedEnv();

		selectAcross(env.selectionState, [1], [2]);
		await handlers.handlePaste(makePasteEvent('x'));

		expect(serialize(env.doc)).toBe('a\nx# kkk\n');
		expect(env.doc.children).toHaveLength(1);
		// Offset 3 is the byte after the pasted `x` in the merged block (`'a\n'` + 1).
		expect(offsets.at(-1)).toBe(3);
	});
});
