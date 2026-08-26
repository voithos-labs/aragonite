// @vitest-environment jsdom
//
// The cell is the prose surface's sibling on the pressed read: `link.openCard` paints from the
// construct the card would edit, and the LIVE selection decides containment — the null the cell's
// chord arm passes is a create policy, not a claim that no range exists.
// Miss-analysis: the pressed read was a mark-row lookup that returned before any read, and no test
// at either surface ever asked a NON-mark command what it painted, so the whole id class with no
// mark row was unasserted.
import { describe, it, expect, afterEach } from 'vitest';
import { mountCell } from './mount-cell';

/** `see [x](https://x.com) here`: the link spans [4, 22), ` here` runs to 27. */
const LINKED = 'see [x](https://x.com) here';

let mounted: ReturnType<typeof mountCell> | undefined;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = undefined;
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

function pressed(start: number, end = start): boolean {
	mounted = mountCell(LINKED, { presentationMode: () => 'live' });
	mounted.el.focus();
	mounted.instance.setSelection(start, end);
	return mounted.instance.isCommandActive!('link.openCard');
}

describe('the link editor’s pressed state on a table cell', () => {
	it('a caret inside the link paints pressed', () => {
		expect(pressed(5)).toBe(true);
	});

	it('a caret in the text after it paints nothing', () => {
		expect(pressed(24)).toBe(false);
	});

	it('a selection running out of the link paints nothing', () => {
		expect(pressed(2, 5)).toBe(false);
	});
});
