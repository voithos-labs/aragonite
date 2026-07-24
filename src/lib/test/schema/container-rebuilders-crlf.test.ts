// A container rebuild re-emits bytes the keystroke never touched, so it must
// reproduce the source's line endings exactly (G4.20). Fixtures come from `parse`
// rather than hand-built nodes: the defects here were in how the rebuilder splits
// a CRLF body, and a hand-built child raw would let the test agree with the bug.
import { describe, it, expect } from 'vitest';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from '../../schema/container-rebuilders';
import { parse } from '../../core/parser';
import { insertEmptyRow } from '../../tree-operations/table-mutations';

describe('rebuildBlockquoteRaw over a CRLF source', () => {
	it('re-emits a blank quote line as `>` + CRLF, not `> ` + CR', () => {
		const node = parse('> a\r\n>\r\n> b\r\n').children[0];
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> a\r\n>\r\n> b\r\n');
	});

	it('re-emits a multi-line quoted paragraph with its CRLF endings', () => {
		const node = parse('> one\r\n> two\r\n').children[0];
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> one\r\n> two\r\n');
	});
});

describe('rebuildListItemRaw over a CRLF source', () => {
	it('leaves a blank continuation line unindented instead of emitting the indent + CR', () => {
		const item = parse('- a\r\n\r\n  b\r\n').children[0].children![0];
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- a\r\n\r\n  b\r\n');
	});
});

describe('rebuildTableRaw over a CRLF source', () => {
	const crlfTable = '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n';

	it('keeps every row and the synthesized delimiter on CRLF', () => {
		const table = parse(crlfTable).children[0];
		rebuildTableRaw(table);
		expect(table.raw).toBe(crlfTable);
	});

	it('gives a row minted by an insert the table ending, not LF', () => {
		const table = parse(crlfTable).children[0];
		insertEmptyRow(table, 1, 'below');
		rebuildTableRowRaw(table.children![2]);
		rebuildTableRaw(table);
		expect(table.raw).toBe('| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n|  |  |\r\n');
	});

	it('leaves an LF table on LF', () => {
		const lfTable = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
		const table = parse(lfTable).children[0];
		rebuildTableRaw(table);
		expect(table.raw).toBe(lfTable);
	});
});
