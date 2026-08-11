// @vitest-environment jsdom
// Visual-line geometry and sticky-measure pixel X require real browser layout — covered by e2e.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import {
	createRangeFromOffsets,
	setCursorOffset,
	getCursorOffset,
	getRangeOffsets,
	getSelectionOffsets,
	hasSelection
} from '../../cursor/content-offsets';

describe('content-offsets', () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement('div');
		container.contentEditable = 'true';
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.removeChild(container);
	});

	describe('createRangeFromOffsets', () => {
		it('builds a range spanning two offsets in plain text', () => {
			container.textContent = 'hello world';
			const range = createRangeFromOffsets(container, asDomTextOffset(6), asDomTextOffset(11));
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe('world');
		});

		it('walks nested element structure and counts characters correctly', () => {
			container.innerHTML = '<span>foo</span> <em>bar</em>';
			const range = createRangeFromOffsets(container, asDomTextOffset(4), asDomTextOffset(7));
			expect(range!.toString()).toBe('bar');
		});

		it('clamps offsets beyond content to the end', () => {
			container.textContent = 'abc';
			const range = createRangeFromOffsets(container, asDomTextOffset(100), asDomTextOffset(200));
			expect(range).not.toBeNull();
			expect(range!.collapsed).toBe(true);
		});

		it('clamps end offset beyond content length to end of content', () => {
			container.textContent = 'hello world';
			const range = createRangeFromOffsets(
				container,
				asDomTextOffset(6),
				asDomTextOffset(Number.MAX_SAFE_INTEGER)
			);
			expect(range).not.toBeNull();
			expect(range!.startOffset).toBe(6);
			expect(range!.collapsed).toBe(false);
		});
	});

	describe('setCursorOffset / getCursorOffset round-trip', () => {
		it.skip(
			'sets and reads cursor at a specific offset — skipped: jsdom does not update ' +
				'document.activeElement when .focus() is called on a div (activeElement stays BODY), ' +
				'so getCursorOffset always returns null. Covered by e2e/tests/keyboard-navigation.spec.ts.',
			() => {
				container.textContent = 'hello world';
				container.focus();

				setCursorOffset(container, asDomTextOffset(6));
				expect(getCursorOffset(container)).toBe(6);

				setCursorOffset(container, asDomTextOffset(0));
				expect(getCursorOffset(container)).toBe(0);
			}
		);

		it('returns null when container is not focused', () => {
			container.textContent = 'hello';
			expect(getCursorOffset(container)).toBeNull();
		});
	});

	describe('getSelectionOffsets', () => {
		it('returns {start, end} for a non-collapsed range', () => {
			container.textContent = 'abcdef';
			container.focus();

			const range = createRangeFromOffsets(container, asDomTextOffset(2), asDomTextOffset(5));
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range!);

			const offsets = getSelectionOffsets(container);
			expect(offsets).toEqual({ start: 2, end: 5 });
		});

		it('returns null for a collapsed selection', () => {
			container.textContent = 'abc';
			container.focus();
			setCursorOffset(container, asDomTextOffset(1));
			expect(getSelectionOffsets(container)).toBeNull();
		});

		// An endpoint outside the container is not this container's to measure: a 0 fallback would
		// read as a real offset. Surfaces treat null as "not mine" and decline.
		it('returns null when the selection reaches outside the container', () => {
			container.textContent = 'abcdef';
			const outside = document.createElement('div');
			outside.textContent = 'xyz';
			document.body.appendChild(outside);

			const range = document.createRange();
			range.setStart(container.firstChild!, 2);
			range.setEnd(outside.firstChild!, 2);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);

			expect(getSelectionOffsets(container)).toBeNull();
			document.body.removeChild(outside);
		});
	});

	describe('getRangeOffsets', () => {
		it('measures a range the selection does not hold — the pending-edit case', () => {
			container.textContent = 'abcdef';
			const range = createRangeFromOffsets(container, asDomTextOffset(1), asDomTextOffset(4));
			expect(getRangeOffsets(container, range!)).toEqual({ start: 1, end: 4 });
		});

		it('measures a collapsed range, unlike getSelectionOffsets', () => {
			container.textContent = 'abcdef';
			const range = createRangeFromOffsets(container, asDomTextOffset(3), asDomTextOffset(3));
			expect(getRangeOffsets(container, range!)).toEqual({ start: 3, end: 3 });
		});
	});

	describe('hasSelection', () => {
		it('returns true when a non-collapsed selection exists', () => {
			container.textContent = 'abcdef';
			container.focus();
			const range = createRangeFromOffsets(container, asDomTextOffset(1), asDomTextOffset(4));
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range!);
			expect(hasSelection()).toBe(true);
		});

		it('returns false when the selection is collapsed', () => {
			container.textContent = 'abc';
			container.focus();
			setCursorOffset(container, asDomTextOffset(1));
			expect(hasSelection()).toBe(false);
		});
	});
});
