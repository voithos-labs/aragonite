// @vitest-environment jsdom
// A block with nothing the mode shows at the caret never reads the selection to find the caret:
// every key and render would pay for nothing. Live shows at most a code span's backticks there.
// Miss-analysis: no test counted what the reveal reads, so turning it on in live mode went unseen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import { createConstructReveal } from '$lib/components/blocks/text/construct-reveal';
import type { PresentationMode } from '$lib/presentation-mode';
import { makeRenderHarness } from '$lib/test/harness/text-render';
import { placeCaretAt } from './math-widget-fixture';

const CONSTRUCTS = 'plain **bold** and *em* and [a link](u)\n';

/** Selection reads across one of each thing that asks the reveal: a selection change, a render
 *  and the three keys it prepares for, with the caret in the block's first text. */
function readsFor(raw: string, mode: PresentationMode): number {
	const node = parse(raw).children[0];
	const harness = makeRenderHarness(node, { mode });
	createTextRender(harness.deps).render();
	const reveal = createConstructReveal({
		get node() {
			return node;
		},
		get reading() {
			return harness.deps.reading;
		},
		getEl: () => harness.el,
		isCrossBlock: () => false
	});
	const text = document.createTreeWalker(harness.el, NodeFilter.SHOW_TEXT).nextNode();
	if (text) placeCaretAt(text as Text, 1);

	const reads = vi.spyOn(window, 'getSelection');
	reveal.update();
	reveal.update(true);
	for (const key of ['ArrowLeft', 'ArrowRight', 'Backspace']) {
		reveal.prepareForKeydown(new KeyboardEvent('keydown', { key }));
	}
	const count = reads.mock.calls.length;
	reads.mockRestore();
	harness.el.remove();
	return count;
}

describe('the reveal reads the selection only where it could show something', () => {
	beforeEach(() => {
		vi.spyOn(document, 'hasFocus').mockReturnValue(true);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		window.getSelection()?.removeAllRanges();
	});

	it('reads nothing in a live block with no code span', () => {
		expect(readsFor(CONSTRUCTS, 'live')).toBe(0);
	});

	// The control: preview-inline shows those same constructs' markers, so it reads the caret.
	it('reads the caret where the mode shows a construct the block holds', () => {
		expect(readsFor(CONSTRUCTS, 'preview-inline')).toBeGreaterThan(0);
	});
});
