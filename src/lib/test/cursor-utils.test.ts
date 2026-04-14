// @vitest-environment jsdom
// Runner note: Vitest + jsdom environment (declared above via docblock).
// jsdom implements the DOM tree walker and Range offset arithmetic correctly,
// so cursor offset round-tripping is testable here. Visual-line geometry and
// sticky-measure pixel X require real browser layout — covered by
// e2e/tests/keyboard-navigation.spec.ts and sticky-column.spec.ts respectively.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	createRangeFromOffsets,
	setCursorOffset,
	getCursorOffset,
	getSelectionOffsets,
	hasSelection
} from '../text-surface/cursor-utils';

describe('cursor-utils', () => {
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
			const range = createRangeFromOffsets(container, 6, 11);
			expect(range).not.toBeNull();
			expect(range!.toString()).toBe('world');
		});

		it('walks nested element structure and counts characters correctly', () => {
			container.innerHTML = '<span>foo</span> <em>bar</em>';
			const range = createRangeFromOffsets(container, 4, 7);
			expect(range!.toString()).toBe('bar');
		});

		it('clamps offsets beyond content to the end', () => {
			container.textContent = 'abc';
			const range = createRangeFromOffsets(container, 100, 200);
			expect(range).not.toBeNull();
			expect(range!.collapsed).toBe(true);
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

				setCursorOffset(container, 6);
				expect(getCursorOffset(container)).toBe(6);

				setCursorOffset(container, 0);
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

			const range = createRangeFromOffsets(container, 2, 5);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range!);

			const offsets = getSelectionOffsets(container);
			expect(offsets).toEqual({ start: 2, end: 5 });
		});

		it('returns null for a collapsed selection', () => {
			container.textContent = 'abc';
			container.focus();
			setCursorOffset(container, 1);
			expect(getSelectionOffsets(container)).toBeNull();
		});
	});

	describe('hasSelection', () => {
		it('returns true when a non-collapsed selection exists', () => {
			container.textContent = 'abcdef';
			container.focus();
			const range = createRangeFromOffsets(container, 1, 4);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range!);
			expect(hasSelection()).toBe(true);
		});

		it('returns false when the selection is collapsed', () => {
			container.textContent = 'abc';
			container.focus();
			setCursorOffset(container, 1);
			expect(hasSelection()).toBe(false);
		});
	});
});
