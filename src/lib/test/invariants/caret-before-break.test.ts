// @vitest-environment jsdom
// G1.75: the caret writer checks every endpoint it writes against an empty block's `<br>`.
import { describe, it, expect, afterEach } from 'vitest';
import { checkCaretBeforeBreak } from '../../invariants/caret-before-break';
import { extendSelectionToRaw } from '../../cursor/widget-offset';
import { takeDevWarns } from '../support/warn-gate';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

/** An empty editable block as the renderers leave it: one placeholder `<br>`. */
function emptyBlock(): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.appendChild(document.createElement('br'));
	document.body.appendChild(el);
	return el;
}

describe('G1.75 no selection endpoint after an empty block’s placeholder <br>', () => {
	it('names a position after the <br> and passes the one before it', () => {
		const el = emptyBlock();
		expect(checkCaretBeforeBreak({ node: el, offset: 1 })?.code).toBe('caret-before-break');
		expect(checkCaretBeforeBreak({ node: el, offset: 0 })).toBeNull();
	});

	it('passes a block whose <br> is not alone', () => {
		const el = emptyBlock();
		el.prepend(document.createElement('span'));
		expect(checkCaretBeforeBreak({ node: el, offset: 2 })).toBeNull();
	});

	it('fires from the caret writer when it rewrites an anchor left after the <br>', () => {
		const el = emptyBlock();
		window.getSelection()!.collapse(el, 1);

		extendSelectionToRaw(el, 0);

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:caret-before-break']);
	});
});
