import { describe, it, expect } from 'vitest';
import { isVerticallyTransparentNode } from '../../core/inline/transparency';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

// The predicate computes inline content on demand, so a freshly parsed node is
// the real shape it sees in production — no pre-population needed.
function block(md: string, index = 0): CstNode {
	return parse(md).children[index];
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

	// Entity glyphs are step-over widgets that carry a column, so skipping an entity-only
	// paragraph in vertical navigation would make `©®` caret-unreachable.
	it('is false for an entity-glyph-only paragraph', () => {
		expect(isVerticallyTransparentNode(block('&copy;&reg;\n'))).toBe(false);
	});

	it('is false for a paragraph mixing text and an image', () => {
		expect(isVerticallyTransparentNode(block('text ![pic](/x.png)\n'))).toBe(false);
	});

	// VR-6 fixes the windowed/non-windowed divergence for image-only blocks and
	// deliberately leaves thematic-break behavior alone.
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

	// A table cell is a grid-column landing, never transparent, so the predicate must not
	// recurse a table the way it does a list. Every cell is image-only to drive that path.
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
				raw: '![a](/a.png)'
			})
		).toBe(false);
	});

	it('is false for an empty container (carries a caret position)', () => {
		expect(
			isVerticallyTransparentNode({
				kind: 'list',
				leadingTrivia: '',
				raw: '',
				metadata: { ordered: false },
				children: []
			})
		).toBe(false);
	});

	// Guards the coupling that keeps transparency answerable without a mounted render, so
	// an off-window image-only paragraph answers the same as an on-window one.
	it('resolves transparency from a raw-only node', () => {
		expect(
			isVerticallyTransparentNode({ kind: 'paragraph', leadingTrivia: '', raw: '![pic](/x.png)\n' })
		).toBe(true);
	});

	it('is false for null/undefined', () => {
		expect(isVerticallyTransparentNode(null)).toBe(false);
		expect(isVerticallyTransparentNode(undefined)).toBe(false);
	});
});
