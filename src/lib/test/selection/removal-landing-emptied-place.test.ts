// Text over a range that took the block it started in opens a paragraph where the range was when the
// caret the removal left sits on a block's syntax, and joins the block when that caret is on text.
// Miss-analysis: the landing rows asked only which block's keymap a command key reads, never whether
// text written at the landing caret lands inside its block's text or in front of its opener.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { emptiedPlace } from '#lib/selection/cross-block/range-removal.js';
import { deleteRange } from '../harness/range-delete';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';

const cell = (path: number[], offset = 0): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});
const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The place `emptiedPlace` names once the range from `start` to `end` is deleted. */
function placeAfterRemoval(source: string, start: SelectionPoint, end: SelectionPoint) {
	// Delete's side, which a typed character's removal takes.
	const result = deleteRange(parse(source), start, end, { gesture: 'Delete' });
	const caret = result.caret(result.newDoc);
	if (!caret) throw new Error('the removal left no caret');
	return emptiedPlace(measured(result.newDoc), { ...result.removed, caret });
}

const TABLE = '| c |\n| - |\n\n';
const TWO_TABLES = '| c |\n| - |\n\n| d |\n| - |\n';

describe('a range from a table held whole to the first byte of the block below', () => {
	const OPENS: Array<[string, string, number[]]> = [
		['an ATX heading', '# Head', [1]],
		['a fenced code block', '```js\nbody\n```', [1]],
		['an HTML block', '<div>\nhi\n</div>', [1]],
		['an indented code block', '    code', [1]],
		['a rule', '---', [1]],
		['a fenced code block opening a list item', '- ```js\n  body\n  ```', [1, 0, 0]]
	];
	for (const [name, block, end] of OPENS) {
		it(`opens a paragraph before ${name}`, () => {
			expect(placeAfterRemoval(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toEqual([0]);
		});
	}

	const JOINS: Array<[string, string, number[]]> = [
		['a paragraph', 'plain', [1]],
		['a setext heading', 'Head\n===', [1]],
		["a quote's paragraph", '> q', [1, 0]],
		["a list item's paragraph", '- li', [1, 0, 0]]
	];
	for (const [name, block, end] of JOINS) {
		it(`joins ${name}`, () => {
			expect(placeAfterRemoval(`${TABLE}${block}\n`, cell([0]), at(end, 0))).toBeNull();
		});
	}
});

describe('a range holding every block after the one above it', () => {
	it('opens a paragraph after a fenced code block, whose end is its closing fence', () => {
		const source = `\`\`\`js\nbody\n\`\`\`\n\n${TWO_TABLES}`;
		expect(placeAfterRemoval(source, cell([1]), cell([2]))).toEqual([1]);
	});

	it('opens a paragraph after a rule', () => {
		expect(placeAfterRemoval(`---\n\n${TWO_TABLES}`, cell([1]), cell([2]))).toEqual([1]);
	});

	// The caret sits where the tables were, past every block, so text never joins the heading.
	it('opens a paragraph after a heading too', () => {
		expect(placeAfterRemoval(`# Head\n\n${TWO_TABLES}`, cell([1]), cell([2]))).toEqual([1]);
	});
});

describe("a range from a table's last row, which takes the table whole", () => {
	const LAST_ROW = '| a |\n| - |\n| 1 |\n\n';
	for (const [name, block] of [
		['a fenced code block', '```js\nbody\n```'],
		['a rule', '---']
	]) {
		it(`opens a paragraph before ${name}`, () => {
			expect(placeAfterRemoval(`${LAST_ROW}${block}\n`, cell([0], 1), at([1], 0))).toEqual([0]);
		});
	}
});

describe('a removal whose caret sits between blocks', () => {
	it("opens a paragraph at that boundary, though the range kept its start table's header", () => {
		const head = '| A | B |\n| --- | --- |\n';
		const source = `${head}| 1 | 2 |\n| 3 | 4 |\n\n${head}| 1 | 2 |\n`;
		expect(placeAfterRemoval(source, cell([0], 2), cell([1], 0))).toEqual([1]);
	});
});

// Miss-analysis: every boundary row named a gap caret or the document's end, so a boundary that
// takes neither returned before the rule for a range that took its start block was asked.
describe('a range that took its start block, ending on a boundary no gap caret takes', () => {
	const DETAILS =
		'one\n\n> [!NOTE]\n> :::note\n> <details>\n> <summary>S</summary>\n>\n> ```\n> x\n> ```\n> ---\n> <div>\n> h\n> </div>\n>\n> </details>\n> :::\n\nafter';
	it('opens a paragraph where the start block was, not on the rule beside it', () => {
		installPlugins(SYNTAX_PLUGINS);
		expect(placeAfterRemoval(DETAILS, at([1, 0, 1, 3], 0), at([2], 5))).toEqual([1, 0, 1, 3]);
	});
});

// Miss-analysis: every range that took its start block started on a table held whole, so a start
// in a row the removal took named a slot among the table's rows, where opening a paragraph throws.
describe('a range that took the table row it started in', () => {
	it('opens a paragraph after the table, never among its rows', () => {
		const doc = parse('| A |\n| - |\n| 1 |\n\n```\nx\n```\n');
		const removed = {
			wrote: true,
			caret: at([1], 0),
			landed: { at: 17, holds: 'text' as const },
			taken: { at: 12, parent: [0] }
		};
		expect(emptiedPlace(measured(doc), removed)).toEqual([1]);
	});
});

describe('a range whose start block survives', () => {
	it('keeps its caret where the range started, even beside a fence', () => {
		expect(placeAfterRemoval('alpha\n\n```js\nbody\n```\n', at([0], 2), at([1], 0))).toBeNull();
	});
});

/** The place `emptiedPlace` names once the text from `from` to `to` in `source` is cut. */
function placeAfterCut(source: string, from: string, to: string) {
	const doc = parse(source);
	const m = measured(doc);
	const start = pointAtByte(m, source.indexOf(from));
	const end = pointAtByte(m, source.indexOf(to) + (to.endsWith('\n') ? to.length : 0));
	if (!start || !end) throw new Error('no point at the range');
	const result = deleteRange(doc, start, end, { gesture: 'cut' });
	return emptiedPlace(measured(result.newDoc), {
		...result.removed,
		caret: result.caret(result.newDoc)
	});
}

// Miss-analysis: no row's commit joined the text below the range to a block above it, so the start
// block's old path always still named the right slot on the tree the commit leaves.
describe('a removal that joins the text below it to a title a definition started above', () => {
	const TITLE = "[a]: /u\n    'code\n# h\ntext\nend'\n\nlast\n";
	// The text joins the title, as the cut and then the text do, while a removal under a started
	// title folds the text into the definition: these bytes hold only until it doesn't.
	const ROWS: Array<[string, string, string, string]> = [
		['the heading line', TITLE, '# h', '# h\n'],
		['the heading to the middle of the line below', TITLE, '# h', 'xt'],
		[
			'the heading line under a second definition',
			"[a]: /u\n    'code\n[b]: /v\n# h\nend'\n\nlast\n",
			'# h',
			'# h\n'
		],
		[
			'the heading line between a definition and its title',
			'[a]: /u\n# h\n"t"\n\nlast\n',
			'# h',
			'# h\n'
		]
	];
	for (const [name, source, from, to] of ROWS) {
		it(`${name}: the text joins the title, where no boundary stands`, () => {
			expect(placeAfterCut(source, from, to)).toBeNull();
		});
	}
});
