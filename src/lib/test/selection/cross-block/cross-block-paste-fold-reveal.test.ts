// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeEnv, makeHandlers, makePasteEvent, selectAcross } from './typed-char-env';

// GH #21's fourth caret door: a cross-block paste whose bytes demote the survivor folds the
// paragraph above into it, so the landing names a slot the gesture never mounted — the door has
// to reveal that slot before reading it for an element.
// Miss-analysis: the settled landing was pinned at the primitive that derives it, never at the
// door that spends it, so both the landing and its reveal could regress with the suite green.

/** The render window as the door sees it: a slot answers an element only once revealed. */
function makeWindowedEnv() {
	const env = makeEnv('a\n# h\n\n# kkk\n');
	const revealed = new Set<string>();
	const offsets: (number | undefined)[] = [];
	const blockEl = document.createElement('div');
	blockEl.append(document.createTextNode('a\nx# kkk\n'));
	blockEl.focus = () => offsets.push(window.getSelection()?.anchorOffset);
	document.body.appendChild(blockEl);

	// Wrapped before the handlers capture it: the gesture's own reveals count, and only the
	// fold's landing is off-window here.
	const reveal = env.deps.revealPath;
	env.deps.revealPath = async (path: number[]) => {
		revealed.add(path.join(','));
		return reveal(path);
	};
	const handlers = makeHandlers(env, [1], {
		getBlockElByPath: (path) => (revealed.has(path.join(',')) ? blockEl : null)
	});
	return { env, handlers, offsets };
}

describe('cross-block paste — a fold above the pasted bytes', () => {
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
