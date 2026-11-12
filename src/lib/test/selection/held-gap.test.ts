// @vitest-environment jsdom
// What a removal's boundary place is held as: the gap there, unless the text at its byte is prose
// a typed letter joins, a block above hides the boundary, or a list's items stand around it.
// Miss-analysis: the landing asked the arrows' rule whether a gap may stand, so a boundary no arrow
// stops at put the caret on the syntax beside it, and no row named such a boundary.
import { describe, expect, it } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { byteOfGap, heldGapOf } from '#lib/selection/range-bytes.js';
import { gapEligibleAt, type GapCaretPosition } from '#lib/selection/gap-caret.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

interface Row {
	source: string;
	/** The boundary the place names: its parent's path and the child it stands before. */
	boundary: [parent: number[], index: number];
	held: 'the gap' | 'a gap an arrow stops at too' | 'the text';
}

const DETAILS = '<summary>S</summary>\n\n```\nx\n```\n\n</details>\n';

const ROWS: Record<string, Row> = {
	'the document’s end under a fence': {
		source: '```\nx\n```\n',
		boundary: [[], 1],
		held: 'the gap'
	},
	'the document’s end under a paragraph': {
		source: 'para\n',
		boundary: [[], 1],
		held: 'the gap'
	},
	'an untitled directive’s title row alone': {
		source: ':::note\n:::\n',
		boundary: [[0], 1],
		held: 'the gap'
	},
	'a titled directive’s title row alone': {
		source: ':::note Title\n:::\n',
		boundary: [[0], 1],
		held: 'the gap'
	},
	'under a title row, above a fence, the body shown': {
		source: `<details open>\n${DETAILS}`,
		boundary: [[0], 1],
		held: 'the gap'
	},
	'under a title row, above a fence, the body hidden': {
		source: `<details>\n${DETAILS}`,
		boundary: [[0], 1],
		held: 'the text'
	},
	'a paragraph’s start below a heading': {
		source: '# h\n\npara\n',
		boundary: [[], 1],
		held: 'the text'
	},
	'a paragraph’s end, ending a quote': {
		source: '> para\n',
		boundary: [[0], 1],
		held: 'the text'
	},
	'a heading’s end, ending a quote': {
		source: '> # head\n',
		boundary: [[0], 1],
		held: 'the gap'
	},
	'a heading’s marker, opening the document': {
		source: '# head\n',
		boundary: [[], 0],
		held: 'the gap'
	},
	'a rule’s end, ending a quote': {
		source: '> a\n>\n> ---\n',
		boundary: [[0], 2],
		held: 'the gap'
	},
	'between a table and a fence': {
		source: '| a |\n| - |\n\n```\nx\n```\n',
		boundary: [[], 1],
		held: 'a gap an arrow stops at too'
	},
	'between a list’s items, a fence opening the second': {
		source: '- a\n- ```\n  x\n  ```\n',
		boundary: [[0], 1],
		held: 'the text'
	}
};

function opened(source: string): Document {
	installPlugins(SYNTAX_PLUGINS);
	return parse(source);
}

describe('a boundary place is held as its gap, unless a letter there joins prose', () => {
	it.each(Object.entries(ROWS))('%s', (_, { source, boundary, held }) => {
		const laid = measured(opened(source));
		const [parentPath, index] = boundary;
		const gap: GapCaretPosition = { parentPath, index };
		const at = byteOfGap(laid, gap)!;
		expect(gapEligibleAt(laid.doc, parentPath, index), 'an arrow stops there').toBe(
			held === 'a gap an arrow stops at too'
		);
		const want =
			held === 'the text' ? null : held === 'the gap' ? { ...gap, held: true as const } : gap;
		expect(heldGapOf(laid, { at, parent: parentPath })).toStrictEqual(want);
	});
});
