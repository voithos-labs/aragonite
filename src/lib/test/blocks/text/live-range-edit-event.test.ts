// @vitest-environment jsdom
//
// The event half of the live range edit: what `resolveLiveRangeEdit` makes of the range an
// InputEvent carries. The joins themselves are covered through `resolveSelectionEdit`; these
// cases cover the reading, where the browser's target range and the DOM caret can disagree.
// Miss-analysis: every join test handed the resolver a range of its own, so none asked what
// happens when `getTargetRanges()` reports a collapsed caret away from where the caret sits.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	resolveLiveRangeEdit,
	type LiveEditCursor
} from '$lib/components/blocks/text/live-selection-edit';

const LINK = 'Some [ab](u)text\n';

/** An `insertText` whose browser target is the static range the cursor stub reads as such. */
function insertEvent(data: string): InputEvent {
	const e = new InputEvent('beforeinput', { inputType: 'insertText', data, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', { value: () => [{} as StaticRange] });
	return e;
}

/** A live collapsed selection in the document, so there is a DOM caret to read. */
function placeCaret(): void {
	const host = document.createElement('div');
	host.textContent = 'x';
	document.body.appendChild(host);
	const range = document.createRange();
	range.setStart(host.firstChild as Text, 0);
	range.collapse(true);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** The event's static range reads as the browser's target; the live Range as the DOM caret. */
function cursorReading(engineTarget: number, domCaret: number): LiveEditCursor {
	return {
		rawRangeOf: (range) =>
			range instanceof Range
				? { start: domCaret, end: domCaret }
				: { start: engineTarget, end: engineTarget },
		getRawSelection: () => null
	};
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('a collapsed insertion whose browser target disagrees with the DOM caret', () => {
	const node = parse(LINK).children[0];

	// Chromium reads the point after a hidden `](u)` as the end of `ab` (raw 8); the caret a
	// commit left past the run sits at 12. The byte belongs where the caret is.
	it('writes the byte at the DOM caret', () => {
		placeCaret();
		const edit = resolveLiveRangeEdit(
			insertEvent(' '),
			node,
			cursorReading(8, 12),
			'live',
			undefined
		);
		expect(edit).toEqual({
			kind: 'rewrite',
			range: { start: 12, end: 12 },
			raw: 'Some [ab](u) text\n',
			caret: 13
		});
	});

	it('leaves the browser its insert where the two agree', () => {
		placeCaret();
		expect(
			resolveLiveRangeEdit(insertEvent(' '), node, cursorReading(8, 8), 'live', undefined)
		).toBeNull();
	});

	// A split leaves the caret at the reopened run's start, and the browser puts the byte past
	// the hidden opener: after the caret, inside the construct, which is where it belongs.
	it('leaves the browser an insert downstream of the caret', () => {
		placeCaret();
		expect(
			resolveLiveRangeEdit(insertEvent(' '), node, cursorReading(6, 5), 'live', undefined)
		).toBeNull();
	});

	it('stays out of every other mode', () => {
		placeCaret();
		expect(
			resolveLiveRangeEdit(insertEvent(' '), node, cursorReading(8, 12), 'source', undefined)
		).toBeNull();
	});
});
