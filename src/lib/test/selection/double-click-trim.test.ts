// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { trimDoubleClickSelection } from '$lib/selection/double-click-trim';

function select(node: Text, start: number, end: number) {
	document.getSelection()!.setBaseAndExtent(node, start, node, end);
}

describe('double-click word selection drops its trailing whitespace', () => {
	const p = document.createElement('p');
	p.textContent = 'hello world';
	document.body.appendChild(p);
	const text = p.firstChild as Text;

	it('pulls the end back over the space Windows Chromium adds', () => {
		select(text, 0, 6);
		expect(trimDoubleClickSelection(document)).toBe(true);
		expect(document.getSelection()!.toString()).toBe('hello');
	});

	it('leaves a bare word alone', () => {
		select(text, 6, 11);
		expect(trimDoubleClickSelection(document)).toBe(false);
		expect(document.getSelection()!.toString()).toBe('world');
	});

	it('does not collapse a selection that is only whitespace', () => {
		select(text, 5, 6);
		expect(trimDoubleClickSelection(document)).toBe(false);
		expect(document.getSelection()!.toString()).toBe(' ');
	});

	it('ignores a collapsed caret', () => {
		select(text, 3, 3);
		expect(trimDoubleClickSelection(document)).toBe(false);
	});
});
