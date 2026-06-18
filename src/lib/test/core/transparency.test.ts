import { describe, it, expect } from 'vitest';
import { isVerticallyTransparentNode } from '../../core/inline/transparency';
import { parse } from '../../core/parser';
import { parseAllInlineContent } from '../../core/inline';
import type { CstNode } from '../../core/nodes';

// Parse like the editor shell does (whole-tree inline cache), so the predicate
// is exercised against the real node shape rather than hand-built inlines.
function block(md: string, index = 0): CstNode {
	const doc = parse(md);
	parseAllInlineContent(doc.children);
	return doc.children[index];
}

describe('isVerticallyTransparentNode', () => {
	it('is true for an image-only paragraph', () => {
		expect(isVerticallyTransparentNode(block('![pic](/x.png)\n'))).toBe(true);
	});

	it('is true for an image-only paragraph with blank surrounding text', () => {
		expect(isVerticallyTransparentNode(block('  ![pic](/x.png)  \n'))).toBe(true);
	});

	it('is false for a text-bearing paragraph', () => {
		expect(isVerticallyTransparentNode(block('hello\n'))).toBe(false);
	});

	it('is false for a paragraph mixing text and an image', () => {
		expect(isVerticallyTransparentNode(block('text ![pic](/x.png)\n'))).toBe(false);
	});

	// Thematic break has no inline content and isn't transparent today, on- or
	// off-window — VR-6 fixes the windowed/non-windowed divergence for image-only
	// blocks; it deliberately does not change thematic-break behavior.
	it('is false for a thematic break', () => {
		expect(isVerticallyTransparentNode(block('---\n'))).toBe(false);
	});

	it('recurses: a list whose every item is image-only is transparent', () => {
		const list = block('- ![a](/a.png)\n- ![b](/b.png)\n');
		expect(list.kind).toBe('list');
		expect(isVerticallyTransparentNode(list)).toBe(true);
	});

	it('recurses: a list with one text item is not transparent', () => {
		const list = block('- ![a](/a.png)\n- text\n');
		expect(isVerticallyTransparentNode(list)).toBe(false);
	});

	// A table cell is a grid-column landing, never transparent — even with
	// image-only content. The predicate must not recurse a table into transparency
	// the way it does a list (the old per-component gate had no table method).
	// Every cell image-only so the children-recursion would reach `true` without
	// the table-family guard — pins the recursion path, not just the leaf branch.
	it('is false for a table whose cells are all image-only', () => {
		const table = block(
			'| ![a](/a.png) | ![b](/b.png) |\n| --- | --- |\n| ![c](/c.png) | ![d](/d.png) |\n'
		);
		expect(table.kind).toBe('table');
		expect(isVerticallyTransparentNode(table)).toBe(false);
	});

	it('is false for a bare table cell with image-only content', () => {
		expect(
			isVerticallyTransparentNode({
				kind: 'tableCell',
				leadingTrivia: '',
				raw: '![a](/a.png)',
				inlineContent: [{ kind: 'image', start: 0, end: 12, url: '/a.png', alt: 'a' }]
			})
		).toBe(false);
	});

	it('is false for an empty container (carries a caret position)', () => {
		expect(
			isVerticallyTransparentNode({ kind: 'list', leadingTrivia: '', raw: '', children: [] })
		).toBe(false);
	});

	// An unparsed cache must degrade to "land on it", matching the component's
	// length === 0 → false, never crash or over-skip.
	it('is false when inlineContent is absent', () => {
		expect(
			isVerticallyTransparentNode({ kind: 'paragraph', leadingTrivia: '', raw: '![pic](/x.png)\n' })
		).toBe(false);
	});

	it('is false for null/undefined', () => {
		expect(isVerticallyTransparentNode(null)).toBe(false);
		expect(isVerticallyTransparentNode(undefined)).toBe(false);
	});
});
