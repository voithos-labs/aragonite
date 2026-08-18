// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extendFocusToNextBlock } from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import { stateAt, el } from './extend-walk-env';

// Forward mirror of keyboard-extend-leaf-walk.test.ts.

describe('extendFocusToNextBlock across a container boundary', () => {
	it('Shift+ArrowDown descends into the container FIRST leaf, not the block after it', () => {
		const doc = parse('para\n\n> a\n>\n> b\n');
		const s = stateAt(doc, [0]);
		expect(extendFocusToNextBlock(s, doc, el(), [0], 'vertical')).toBe(true);
		expect(s.focus).toEqual({ path: [1, 0], offset: 0 });
	});

	it('Shift+ArrowRight from a container LAST leaf steps out to the START of the block below', () => {
		const doc = parse('> a\n>\n> b\n\npara\n');
		const s = stateAt(doc, [0, 1]);
		expect(extendFocusToNextBlock(s, doc, el(), [0, 1], 'horizontal')).toBe(true);
		expect(s.focus).toEqual({ path: [1], offset: 0 });
	});

	it("reports no move from the document's last leaf", () => {
		const doc = parse('> a\n> b\n\npara\n');
		const s = stateAt(doc, [1]);
		expect(extendFocusToNextBlock(s, doc, el(), [1], 'vertical')).toBe(false);
	});

	it('skips a transparent-only container without landing on its leaves', () => {
		const doc = parse('x\n\n> ![a](u)\n>\n> ![b](v)\n\ny\n');
		const s = stateAt(doc, [0]);
		expect(extendFocusToNextBlock(s, doc, el(), [0], 'vertical')).toBe(true);
		expect(s.focus).toEqual({ path: [2], offset: 0 });
	});
});
