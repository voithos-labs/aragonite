// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { focusMovedOutsideReplacement } from '$lib/editor-actions/replacement-focus';

function focusBlockAt(path: number[]): void {
	const host = document.createElement('div');
	host.setAttribute('data-block-path', JSON.stringify(path));
	const editable = document.createElement('div');
	editable.tabIndex = 0;
	host.appendChild(editable);
	document.body.appendChild(host);
	editable.focus();
}

describe('focusMovedOutsideReplacement', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('restores when focus fell to body (kind-change remount ate the element)', () => {
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});

	it('restores when focus still sits inside the replaced window', () => {
		focusBlockAt([1]);
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(false);
	});

	it('skips when focus moved to a block outside the window (blur commit)', () => {
		focusBlockAt([0]);
		expect(focusMovedOutsideReplacement([], 1, 2)).toBe(true);
	});

	it('skips when focus moved to a different container subtree', () => {
		focusBlockAt([3, 0]);
		expect(focusMovedOutsideReplacement([2], 0, 1)).toBe(true);
	});

	it('restores for a nested window still holding focus', () => {
		focusBlockAt([2, 1]);
		expect(focusMovedOutsideReplacement([2], 1, 2)).toBe(false);
	});
});
