// G2.15: a rebuild of a parsed container writes back the bytes it read, so the first edit changes
// only the lines it edits.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, Document } from '$lib/core/nodes';
import { metadataOf } from '$lib/core/nodes';
import { splitLines } from '$lib/core/lines';
import { walkBlocks } from '$lib/core/paths';
import { rebuildTableRaw, rebuildTableRowRaw } from '$lib/schema/container-rebuilders';
import { rebuildContainerRawIfContainer } from '$lib/schema/container-raw';
import {
	arbGfmDoc,
	arbIndentedGfmDoc,
	arbRespelledContainerDoc,
	arbRespelledTableDoc,
	freshOrFixedSeed
} from './arbitraries';

const PARAMS = { numRuns: 300, seed: freshOrFixedSeed(151515) } as const;

function tablesOf(doc: Document): CstNode[] {
	const tables: CstNode[] = [];
	walkBlocks(doc, (node) => {
		if (node.kind === 'table') tables.push(node);
	});
	return tables;
}

/** Each row rebuilt, then the table, the order the commit's chain rebuild runs them in. */
function rebuild(table: CstNode): void {
	for (const row of table.children!) rebuildTableRowRaw(row);
	rebuildTableRaw(table);
}

const bytesOf = (table: CstNode): string[] => [table.raw, ...table.children!.map((r) => r.raw)];

function rebuildsToItsBytes(source: string): void {
	for (const table of tablesOf(parse(source))) {
		const before = bytesOf(table);
		rebuild(table);
		expect(bytesOf(table)).toEqual(before);
	}
}

/** Every node's bytes, children first. */
function containerBytes(nodes: readonly CstNode[]): string[] {
	return nodes.flatMap((node) => [...containerBytes(node.children ?? []), node.raw]);
}

/** Every container rebuilt innermost first, as a chain rebuild runs them: none moves a byte. */
function everyContainerRebuildsToItsBytes(source: string): void {
	const doc = parse(source);
	const before = containerBytes(doc.children);
	const rebuildAll = (nodes: readonly CstNode[]) => {
		for (const node of nodes) {
			rebuildAll(node.children ?? []);
			rebuildContainerRawIfContainer(node);
		}
	};
	rebuildAll(doc.children);
	expect(containerBytes(doc.children)).toEqual(before);
}

/** The cells a reader takes from a row, surplus included. */
const readingOf = (table: CstNode): string[][] =>
	table.children!.map((row) => [
		...row.children!.map((cell) => cell.raw),
		...(metadataOf(row, 'tableRow').surplusCells ?? [])
	]);

const lineTexts = (raw: string): string[] => splitLines(raw).map((line) => line.raw);

/** A cell of a top-level table written, then rebuilt: its row's line is the only one that moved,
 *  and a reload reads the cells the tree holds. */
function cellWriteMovesItsLine(source: string, pick: number, cellPick: number): void {
	const doc = parse(source);
	const tables = doc.children.filter((node) => node.kind === 'table');
	if (tables.length === 0) return;
	const table = tables[pick % tables.length];
	const rowIndex = cellPick % table.children!.length;
	const row = table.children![rowIndex];
	const cell = row.children![cellPick % row.children!.length];
	const linesBefore = lineTexts(table.raw);
	cell.raw += 'Q';
	rebuild(table);

	const lineIndex = rowIndex === 0 ? 0 : rowIndex + 1;
	const linesAfter = lineTexts(table.raw);
	expect(linesAfter.length).toBe(linesBefore.length);
	linesAfter.forEach((line, i) => {
		if (i !== lineIndex) expect(line).toBe(linesBefore[i]);
	});
	const reread = parse(serialize(doc)).children[doc.children.indexOf(table)];
	expect(reread.kind).toBe('table');
	expect(readingOf(reread)).toEqual(readingOf(table));
}

describe('G2.15 a rebuild of a parsed table is the identity', () => {
	it('over valid-ish GFM docs', () => {
		fc.assert(fc.property(arbGfmDoc, rebuildsToItsBytes), PARAMS);
	});

	it('over tables spelled every way GFM reads the same', () => {
		fc.assert(fc.property(arbRespelledTableDoc, rebuildsToItsBytes), PARAMS);
	});

	it.each([
		['a delimiter row ending in LF under a CRLF header', '| H0 |\r\n| --- |\n```\r\n```\n'],
		['rows with no trailing pipe, at the top and in a quote', '|a\n|-\n\n> a\n> -\n']
	])('pins %s', (_name, source) => {
		rebuildsToItsBytes(source);
	});
});

describe('G2.15 a rebuild of any parsed container is the identity', () => {
	it.each([
		['valid-ish GFM docs', arbGfmDoc],
		['indented GFM docs', arbIndentedGfmDoc],
		['quotes and lists spelled every way GFM reads the same', arbRespelledContainerDoc]
	])('over %s', (_name, arbitrary) => {
		fc.assert(fc.property(arbitrary, everyContainerRebuildsToItsBytes), PARAMS);
	});
});

describe('a cell write moves only its own line', () => {
	it('over tables spelled every way GFM reads the same', () => {
		fc.assert(fc.property(arbRespelledTableDoc, fc.nat(), fc.nat(), cellWriteMovesItsLine), PARAMS);
	});
});
