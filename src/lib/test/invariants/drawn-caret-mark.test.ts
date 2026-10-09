// @vitest-environment jsdom
// G1.77: the attribute hiding the browser's caret sits on exactly the editable the drawn caret draws
// for, including a pointer-down beside a widget, where it hides the browser's caret and draws none.
// Miss-analysis: the predicate had no rows; its one caller decided which states mark the editable.
import { describe, expect, it } from 'vitest';
import { checkOneCaretShowing } from '#lib/invariants/drawn-caret.js';
import type { DrawnCaretTarget } from '#lib/caret/drawn-caret-target.js';

const MARK = 'data-caret-drawn';
const RECT = { x: 1, y: 2, height: 20 };

function page(marked: boolean) {
	const root = document.createElement('div');
	const source = document.createElement('div');
	if (marked) source.setAttribute(MARK, '');
	root.append(source, document.createElement('div'));
	return { root, source };
}

const MARKS: Array<[string, DrawnCaretTarget]> = [
	['a text caret', { state: 'text', rect: RECT }],
	['a widget edge', { state: 'widget', rect: { ...RECT, width: 1.5 } }],
	['a pointer-down beside a widget, which draws no bar', { state: 'widget', rect: null }],
	['a gap caret', { state: 'gap' }]
];

const UNMARKED: Array<[string, DrawnCaretTarget]> = [
	['the browser’s own caret', { state: 'native' }],
	['no caret', { state: 'hidden' }]
];

describe('G1.77 the mark sits on the editable the drawn caret draws for', () => {
	it.each(MARKS)('marked for %s', (_, target) => {
		const marked = page(true);
		expect(checkOneCaretShowing(marked.root, MARK, target, marked.source)).toBeNull();
		const bare = page(false);
		expect(checkOneCaretShowing(bare.root, MARK, target, bare.source)?.code).toBe(
			'drawn-caret-mark'
		);
	});

	it.each(UNMARKED)('unmarked for %s', (_, target) => {
		const bare = page(false);
		expect(checkOneCaretShowing(bare.root, MARK, target, bare.source)).toBeNull();
		const marked = page(true);
		expect(checkOneCaretShowing(marked.root, MARK, target, marked.source)?.code).toBe(
			'drawn-caret-mark'
		);
	});
});
