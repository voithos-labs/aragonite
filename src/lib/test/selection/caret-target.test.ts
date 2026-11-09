// Resolving a landing position to a leaf on the tree alone: containers descend by their entry edge,
// closed bodies become their title row.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { docPathFrom } from '../../core/coordinate-spaces';
import { caretTargetFor } from '../../selection/caret-target';
import { registerChromePluginsForTests } from './chrome-plugins';

const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';

function target(doc: Document, path: number[], offset: number, openCollapsed = false) {
	return caretTargetFor(doc, { path: docPathFrom(path), offset }, { openCollapsed });
}

beforeEach(registerChromePluginsForTests);

describe('caretTargetFor', () => {
	it('a leaf keeps its offset, sentinels included; the block resolves them on focus', () => {
		const doc = parse('abc\n');
		expect(target(doc, [0], 2)).toEqual({ leafPath: [0], offset: 2 });
		expect(target(doc, [0], CURSOR_END)).toEqual({ leafPath: [0], offset: CURSOR_END });
	});

	it('a dead path resolves to nothing', () => {
		expect(target({ kind: 'document', prefix: '', children: [], suffix: '' }, [], 0)).toBeNull();
		expect(target(parse('abc\n'), [3], 0)).toBeNull();
		expect(target(parse('abc\n'), [0, 0], 0)).toBeNull();
	});

	// [0] the list, [0,1] the second item, whose last child is a two-by-two table.
	const LIST_TABLE = '- a\n- b\n\n  | h1 | h2 |\n  | -- | -- |\n  | c1 | c2 |\n';

	const edges: Array<[string, number, number[], number]> = [
		['0', 0, [0, 0, 0], 0],
		['CURSOR_START', CURSOR_START, [0, 0, 0], CURSOR_START],
		['CURSOR_EXACT_START', CURSOR_EXACT_START, [0, 0, 0], CURSOR_EXACT_START],
		['CURSOR_END', CURSOR_END, [0, 1, 1, 1, 1], CURSOR_END]
	];
	for (const [name, offset, leafPath, leafOffset] of edges) {
		it(`a container entered with ${name} lands in its ${leafPath.length > 3 ? 'last' : 'first'} leaf`, () => {
			expect(target(parse(LIST_TABLE), [0], offset)).toEqual({ leafPath, offset: leafOffset });
		});
	}

	it('a byte offset into a strip container lands on the leaf holding that byte', () => {
		// One paragraph over two quoted lines; byte 5 is the second line's marker, which maps to
		// the start of that line in the paragraph.
		expect(target(parse('> a\n> b\n'), [0], 5)).toEqual({ leafPath: [0, 0], offset: 2 });
	});

	it('a byte offset into a table, which cannot map bytes, lands at its last cell end', () => {
		const doc = parse('| a | b |\n| - | - |\n| c | d |\n');
		expect(target(doc, [0], 5)).toEqual({ leafPath: [0, 1, 1], offset: CURSOR_END });
	});

	it('a path into a closed body lands at the end of the title row', () => {
		const doc = parse('Above\n\n' + CLOSED);
		expect(target(doc, [1, 1], 3)).toEqual({ leafPath: [1, 0], offset: CURSOR_END });
		expect(target(doc, [1], CURSOR_END)).toEqual({ leafPath: [1, 0], offset: CURSOR_END });
	});

	it('a navigation that opens the container goes into the body as asked', () => {
		const doc = parse('Above\n\n' + CLOSED);
		expect(target(doc, [1, 1], 3, true)).toEqual({ leafPath: [1, 1], offset: 3 });
	});

	it('the outermost closed container wins when two are nested', () => {
		const doc = parse(
			'<details>\n<summary>Outer</summary>\n\nBody\n\n' + CLOSED + '\n</details>\n'
		);
		expect(target(doc, [0, 2, 1], 0)).toEqual({ leafPath: [0, 0], offset: CURSOR_END });
	});
});
