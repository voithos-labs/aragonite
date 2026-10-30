// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
	holdsNativeRange,
	nativeRangeIn,
	rawSelectionIn,
	readNativeSelection
} from '../../browser/selection-read';

describe('the live selection readers', () => {
	beforeEach(() => window.getSelection()?.removeAllRanges());
	afterEach(() => {
		window.getSelection()?.removeAllRanges();
		document.body.replaceChildren();
	});

	/** Two blocks of text: `ab` in the first, `cd` in the second. */
	function twoBlocks(): { first: HTMLElement; second: HTMLElement; a: Text; c: Text } {
		const first = document.createElement('div');
		const second = document.createElement('div');
		first.textContent = 'ab';
		second.textContent = 'cd';
		document.body.append(first, second);
		return { first, second, a: first.firstChild as Text, c: second.firstChild as Text };
	}

	function select(anchor: Node, anchorOffset: number, focus: Node, focusOffset: number): void {
		window.getSelection()!.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
	}

	it('read null when the browser holds no range', () => {
		const { first } = twoBlocks();
		expect(readNativeSelection()).toBeNull();
		expect(rawSelectionIn(first)).toBeNull();
		expect(holdsNativeRange()).toBe(false);
		expect(nativeRangeIn(first)).toBe(false);
	});

	it('reads an end outside the element as null, not as no selection', () => {
		const { first, second, a, c } = twoBlocks();
		select(c, 1, c, 1);
		expect(rawSelectionIn(first)).toEqual({ start: null, end: null, collapsed: true });
		select(a, 1, c, 1);
		expect(rawSelectionIn(first)).toEqual({ start: 1, end: null, collapsed: false });
		expect(rawSelectionIn(second)).toEqual({ start: null, end: 1, collapsed: false });
	});

	it('reads a backward range in document order, as the range runs', () => {
		const { first, a } = twoBlocks();
		select(a, 2, a, 0);
		expect(rawSelectionIn(first)).toEqual({ start: 0, end: 2, collapsed: false });
		expect(readNativeSelection()).toMatchObject({
			anchor: { node: a, offset: 2 },
			focus: { node: a, offset: 0 },
			collapsed: false
		});
	});

	it('reads ends held at element offsets as the text around them', () => {
		const { first, second } = twoBlocks();
		select(first, 0, first, 1);
		expect(rawSelectionIn(first)).toEqual({ start: 0, end: 2, collapsed: false });
		select(first, 1, second, 0);
		expect(rawSelectionIn(second)).toEqual({ start: null, end: 0, collapsed: false });
	});

	it('reads a caret as one offset at both ends', () => {
		const { first, a } = twoBlocks();
		select(a, 1, a, 1);
		expect(rawSelectionIn(first)).toEqual({ start: 1, end: 1, collapsed: true });
		expect(holdsNativeRange()).toBe(false);
	});

	it('scopes a held range by where its anchor sits, and holds one anywhere in the document', () => {
		const { first, second, a, c } = twoBlocks();
		select(a, 1, c, 1);
		expect(holdsNativeRange()).toBe(true);
		expect(nativeRangeIn(first)).toBe(true);
		expect(nativeRangeIn(second)).toBe(false);
	});
});
