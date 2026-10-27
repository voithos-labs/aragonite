import { describe, it, expect } from 'vitest';
import { fixtureReading } from '../../harness/fixture-grammar';
import { isVerticallyTransparentNode } from '../../../core/inline/transparency';
import { parse } from '../../../core/parser';
import type { CstNode } from '../../../core/nodes';

// The predicate computes inline content on demand, so a freshly parsed node is
// the real shape it sees in production — no pre-population needed.
function block(md: string, index = 0): CstNode {
	return parse(md).children[index];
}

describe('isVerticallyTransparentNode', () => {
	it('is true for an image-only paragraph', () => {
		expect(isVerticallyTransparentNode(block('![pic](/x.png)\n'), fixtureReading())).toBe(true);
	});

	it('is true for an image-only paragraph with blank surrounding text', () => {
		expect(isVerticallyTransparentNode(block('  ![pic](/x.png)  \n'), fixtureReading())).toBe(true);
	});

	it('is false for a text-bearing paragraph', () => {
		expect(isVerticallyTransparentNode(block('hello\n'), fixtureReading())).toBe(false);
	});

	// Entity glyphs are step-over widgets that carry a column, so skipping an entity-only
	// paragraph in vertical navigation would make `©®` caret-unreachable.
	it('is false for an entity-glyph-only paragraph', () => {
		expect(isVerticallyTransparentNode(block('&copy;&reg;\n'), fixtureReading())).toBe(false);
	});

	it('is false for a paragraph mixing text and an image', () => {
		expect(isVerticallyTransparentNode(block('text ![pic](/x.png)\n'), fixtureReading())).toBe(
			false
		);
	});

	// The predicate answers the same windowed or not (VR-6); a thematic break is never transparent.
	it('is false for a thematic break', () => {
		expect(isVerticallyTransparentNode(block('---\n'), fixtureReading())).toBe(false);
	});

	it('recurses: a list whose every item is image-only is transparent', () => {
		const list = block('- ![a](/a.png)\n- ![b](/b.png)\n');
		expect(list.kind).toBe('list');
		expect(isVerticallyTransparentNode(list, fixtureReading())).toBe(true);
	});

	it('recurses: a list with one text item is not transparent', () => {
		const list = block('- ![a](/a.png)\n- text\n');
		expect(isVerticallyTransparentNode(list, fixtureReading())).toBe(false);
	});

	// A table cell is a grid-column landing, never transparent, so the predicate must not
	// recurse a table the way it does a list. Every cell is image-only to drive that path.
	it('is false for a table whose cells are all image-only', () => {
		const table = block(
			'| ![a](/a.png) | ![b](/b.png) |\n| --- | --- |\n| ![c](/c.png) | ![d](/d.png) |\n'
		);
		expect(table.kind).toBe('table');
		expect(isVerticallyTransparentNode(table, fixtureReading())).toBe(false);
	});

	it('is false for a bare table cell with image-only content', () => {
		expect(
			isVerticallyTransparentNode(
				{
					kind: 'tableCell',
					leadingTrivia: '',
					raw: '![a](/a.png)'
				},
				fixtureReading()
			)
		).toBe(false);
	});

	it('is false for an empty container (carries a caret position)', () => {
		expect(
			isVerticallyTransparentNode(
				{
					kind: 'list',
					leadingTrivia: '',
					raw: '',
					metadata: { ordered: false },
					children: []
				},
				fixtureReading()
			)
		).toBe(false);
	});

	// Guards the coupling that keeps transparency answerable without a mounted render, so
	// an off-window image-only paragraph answers the same as an on-window one.
	it('resolves transparency from a raw-only node', () => {
		expect(
			isVerticallyTransparentNode(
				{ kind: 'paragraph', leadingTrivia: '', raw: '![pic](/x.png)\n' },
				fixtureReading()
			)
		).toBe(true);
	});

	it('is false for null/undefined', () => {
		expect(isVerticallyTransparentNode(null, fixtureReading())).toBe(false);
		expect(isVerticallyTransparentNode(undefined, fixtureReading())).toBe(false);
	});
});

// Miss-analysis: every row read the block in source mode, so none saw a mode that hides a link's
// markers leave the block drawing only the picture inside it.
describe('isVerticallyTransparentNode reads the block as the mode draws it', () => {
	it.each([
		['a picture a link wraps', '[![a](/x.png)](https://y)\n', 'live', true],
		['a picture a link wraps', '[![a](/x.png)](https://y)\n', 'preview-inline', true],
		['a picture a link wraps', '[![a](/x.png)](https://y)\n', 'preview-block', false],
		['a picture a link wraps', '[![a](/x.png)](https://y)\n', 'source', false],
		['a picture emphasis wraps', '*![a](/x.png)*\n', 'live', true],
		['a link holding a picture and text', '[![a](/x.png) b](https://y)\n', 'live', false]
	] as const)('%s %j in %s: %s', (_, source, mode, transparent) => {
		expect(isVerticallyTransparentNode(block(source), fixtureReading({}, mode))).toBe(transparent);
	});
});
