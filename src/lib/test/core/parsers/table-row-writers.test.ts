// Every route that writes a table row or delimiter line, over the shapes a row takes, against the
// bytes it writes; a CRLF document's lines are the same bytes ending in CRLF.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, TableAlignment } from '$lib/core/nodes';
import { rebuildTableRaw, rebuildTableRowRaw } from '$lib/schema/container-rebuilders';
import {
	insertEmptyColumn,
	insertEmptyRow,
	setAlignment
} from '$lib/tree-operations/table-mutations';
import { copyRectangleAsSubTable } from '$lib/tree-operations/sub-table-copy';
import { tryCompleteTableRow } from '$lib/core/parsers/table-completion';
import { insertCatalogue } from '$lib/schema/insert-catalogue';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps, pasteContext } from '$lib/test/harness/editor-actions';

const ENDINGS = [
	['LF', '\n'],
	['CRLF', '\r\n']
] as const;

const inEnding = (lf: string, ending: string) => lf.replace(/\n/g, ending);

// Tight spellings, so a route that writes the padded spelling shows it.
const TIGHT: Record<TableAlignment, string> = { none: '-', left: ':-', center: ':-:', right: '-:' };

interface Shape {
	name: string;
	header: string[];
	alignments: TableAlignment[];
	body: string[][];
	realign: [number, TableAlignment];
	/** The bytes each route writes for this shape in an LF document. */
	lf: Record<'copy' | 'rowBelow' | 'rowAbove' | 'columnRight' | 'columnLast' | 'realign', string>;
	completed: string[];
}

const SHAPES: Shape[] = [
	{
		name: 'plain cells, no alignment and left',
		header: ['a', 'b'],
		alignments: ['none', 'left'],
		body: [['1', '2']],
		realign: [1, 'right'],
		lf: {
			copy: '| a | b |\n| --- | :--- |\n| 1 | 2 |\n',
			rowBelow: '|a|b|\n|-|:-|\n|1|2|\n|  |  |\n',
			rowAbove: '|  |  |\n|-|:-|\n|a|b|\n|1|2|\n',
			columnRight: '|a|  |b|\n|-| - |:-|\n|1|  |2|\n',
			columnLast: '|a|b|  |\n|-|:-| - |\n|1|2|  |\n',
			realign: '|a|b|\n|-|---:|\n|1|2|\n'
		},
		completed: ['| a | b |', '| --- | --- |', '|  |  |']
	},
	{
		name: 'escaped pipes, center and right',
		header: ['a \\| x', 'b'],
		alignments: ['center', 'right'],
		body: [['1', '2 \\| 3']],
		realign: [0, 'left'],
		lf: {
			copy: '| a \\| x | b |\n| :---: | ---: |\n| 1 | 2 \\| 3 |\n',
			rowBelow: '|a \\| x|b|\n|:-:|-:|\n|1|2 \\| 3|\n|  |  |\n',
			rowAbove: '|  |  |\n|:-:|-:|\n|a \\| x|b|\n|1|2 \\| 3|\n',
			columnRight: '|a \\| x|  |b|\n|:-:| --- |-:|\n|1|  |2 \\| 3|\n',
			columnLast: '|a \\| x|b|  |\n|:-:|-:| --- |\n|1|2 \\| 3|  |\n',
			realign: '|a \\| x|b|\n|:---|-:|\n|1|2 \\| 3|\n'
		},
		completed: ['| a \\| x | b |', '| --- | --- |', '|  |  |']
	},
	{
		name: 'empty cells and a short row, three columns',
		header: ['a', '', 'c'],
		alignments: ['right', 'none', 'center'],
		body: [['', '', ''], ['x']],
		realign: [1, 'left'],
		lf: {
			copy: '| a |  | c |\n| ---: | --- | :---: |\n|  |  |  |\n| x |  |  |\n',
			rowBelow: '|a||c|\n|-:|-|:-:|\n||||\n|x|\n|  |  |  |\n',
			rowAbove: '|  |  |  |\n|-:|-|:-:|\n|a||c|\n||||\n|x|\n',
			columnRight: '|a||  |c|\n|-:|-| - |:-:|\n||||  |\n|x|\n',
			columnLast: '|a||c|  |\n|-:|-|:-:| - |\n||||  |\n|x|\n',
			realign: '|a||c|\n|-:|:---|:-:|\n||||\n|x|\n'
		},
		completed: ['| a |  | c |', '| --- | --- | --- |', '|  |  |  |']
	},
	{
		name: 'a surplus cell, left and right',
		header: ['a', 'b'],
		alignments: ['left', 'right'],
		body: [['1', '2', '3']],
		realign: [0, 'center'],
		lf: {
			copy: '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n',
			rowBelow: '|a|b|\n|:-|-:|\n|1|2|3|\n|  |  |\n',
			rowAbove: '|  |  |\n|:-|-:|\n|a|b|\n|1|2|3|\n',
			columnRight: '|a|  |b|\n|:-| --- |-:|\n|1|  |2|3|\n',
			columnLast: '|a|b|  |\n|:-|-:| --- |\n|1|2|  |3|\n',
			realign: '|a|b|\n|:---:|-:|\n|1|2|3|\n'
		},
		completed: ['| a | b |', '| --- | --- |', '|  |  |']
	}
];

function tableOf(shape: Shape, ending: string): CstNode {
	const line = (cells: string[]) => `|${cells.join('|')}|${ending}`;
	const source =
		line(shape.header) +
		line(shape.alignments.map((a) => TIGHT[a])) +
		shape.body.map(line).join('');
	return parse(source).children[0];
}

/** The rebuilds a commit runs after a table edit: each row, then the table. */
function rebuilt(table: CstNode): string {
	for (const row of table.children!) rebuildTableRowRaw(row);
	rebuildTableRaw(table);
	return table.raw;
}

const ROUTES: Record<keyof Shape['lf'], (table: CstNode, shape: Shape) => string> = {
	copy: (table, shape) =>
		copyRectangleAsSubTable(
			table,
			{ rowIdx: 0, colIdx: 0 },
			{ rowIdx: table.children!.length - 1, colIdx: shape.header.length - 1 }
		),
	rowBelow: (table) => {
		insertEmptyRow(table, table.children!.length - 1, 'below');
		return rebuilt(table);
	},
	rowAbove: (table) => {
		insertEmptyRow(table, 0, 'above');
		return rebuilt(table);
	},
	columnRight: (table) => {
		insertEmptyColumn(table, 0, 'right');
		return rebuilt(table);
	},
	columnLast: (table, shape) => {
		insertEmptyColumn(table, shape.header.length - 1, 'right');
		return rebuilt(table);
	},
	realign: (table, shape) => {
		setAlignment(table, ...shape.realign);
		return rebuilt(table);
	}
};

describe.each(ENDINGS)('the table rows each route writes, %s', (_, ending) => {
	for (const shape of SHAPES) {
		it.each(Object.keys(ROUTES) as (keyof Shape['lf'])[])(`${shape.name}: %s`, (route) => {
			expect(ROUTES[route](tableOf(shape, ending), shape)).toBe(inEnding(shape.lf[route], ending));
		});
	}

	// A row with no edge pipes whose first cell changed is written in the plain spelling.
	it.each([
		['x | y', '| # X | y |\n'],
		['x | y | z', '| # X | y | z |\n']
	])('a rewritten row %j', (row, lf) => {
		const table = parse(inEnding(`| a | b |\n| --- | --- |\n${row}\n`, ending)).children[0];
		table.children![1].children![0].raw = '# X';
		expect(rebuilt(table)).toBe(inEnding(`| a | b |\n| --- | --- |\n${lf}`, ending));
	});

	it('the insert menu’s table, landed in the document', async () => {
		const { deps } = makeEditorActionsDeps(parse(`a${ending}`));
		const controller = createUndoController(deps);
		const blockEdit = createBlockEditActions(deps, controller);
		await blockEdit.insertParagraph(1, '');
		await pasteDispatch(
			{ pastedText: tableEntry().markdown, targetPath: [1], offset: 0 },
			pasteContext({
				doc: deps.doc,
				blockEdit,
				controller: createPasteCoordinator(deps, controller)
			})
		);
		expect(serialize(deps.doc)).toBe(
			inEnding('a\n\n| Column | Column |\n| --- | --- |\n|  |  |\n', ending)
		);
	});
});

describe('the lines the Enter completer answers a header with', () => {
	it.each(SHAPES)('$name', (shape) => {
		expect(tryCompleteTableRow(`|${shape.header.join('|')}|`)?.lines).toEqual(shape.completed);
	});
});

const tableEntry = () => insertCatalogue(everyInstalledPlugin).find((e) => e.id === 'table')!;

describe('the insert menu’s table', () => {
	it('with no size', () => {
		expect(tableEntry().markdown).toBe('| Column | Column |\n| --- | --- |\n|  |  |\n');
	});

	it.each([
		['1x2', '| Column |\n| --- |\n|  |\n'],
		['2x2', '| Column | Column |\n| --- | --- |\n|  |  |\n'],
		[
			'3x4',
			'| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |\n'
		]
	])('%s', (size, markdown) => {
		expect(tableEntry().withArgument!(size).markdown).toBe(markdown);
	});
});
