// @vitest-environment jsdom
//
// The event half of the live ranged-edit seam: what `resolveLiveRangeEdit` makes of the range an
// InputEvent carries. The joins themselves are pinned through `resolveSelectionEdit`; these rows
// pin the READ, where the engine's target range and the DOM caret can disagree.
// Miss-analysis: every seam test handed the resolver a range of its own, so no row asked what
// happens when `getTargetRanges()` spells a collapsed caret away from where the caret sits.
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import {
	resolveLiveRangeEdit,
	type LiveEditCursor
} from '$lib/components/blocks/text/live-selection-edit';

const LINK = 'Some [ab](u)text\n';

/** An `insertText` whose engine target is the static range the cursor stub reads as such. */
function insertEvent(data: string): InputEvent {
	const e = new InputEvent('beforeinput', { inputType: 'insertText', data, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', { value: () => [{} as StaticRange] });
	return e;
}

/** A live collapsed selection in the document, so the seam has a DOM caret to read. */
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

/** The event's static range reads as the engine's target; the live Range as the DOM caret. */
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

describe('a collapsed insertion whose engine target disagrees with the DOM caret', () => {
	const node = parse(LINK).children[0];

	// Chromium spells the pixel after a hidden `](u)` as the end of `ab` (raw 8); the caret a
	// commit parked past the run sits at 12. The byte belongs where the caret is.
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

	it('leaves the engine its insert where the two agree', () => {
		placeCaret();
		expect(
			resolveLiveRangeEdit(insertEvent(' '), node, cursorReading(8, 8), 'live', undefined)
		).toBeNull();
	});

	// A split parks the caret at the reopened run's start, and the engine lands the byte past the
	// hidden opener: downstream of the caret, inside the construct, which is where it belongs.
	it('leaves the engine an insert downstream of the caret', () => {
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
