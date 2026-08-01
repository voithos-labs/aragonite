import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode, Document } from '$lib/core/nodes';
import { rebuildContainerRaw } from '$lib/schema/container-raw';
import {
	assembleListHalf,
	buildListItemWithContent
} from '$lib/tree-operations/list/list-builders';
import {
	expectParseConverged,
	parseConverges,
	describeConvergence
} from '$lib/test/harness/parse-converged';

// The belt for the belt. Wiring parse-convergence at every vacuous round-trip site is
// only sound if it catches the live-tree-vs-raw divergence bytes are blind to AND stays
// green on the empty-paragraph shapes the editor really reaches — both pinned here.

function docOf(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

function emptyParagraph(): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
}

// ── Empty paragraphs converge exactly (0.9.36: the parser mints them too) ────

describe('parseConverges on the empty-paragraph shapes the editor reaches', () => {
	it('an empty list item holding an empty-paragraph placeholder', () => {
		const listTemplate = parse('- a\n').children[0];
		const emptyItem = buildListItemWithContent(listTemplate.children![0], [emptyParagraph()]);
		const list = assembleListHalf(listTemplate, [emptyItem], 1);
		expect(list.raw).toBe('- \n');
		expect(parseConverges(docOf([list]))).toBe(true);
	});

	it.each([
		['LF', '> hi\n', '\n'],
		// CRLF puts the carriage return in the line's ending, not its text — the one path
		// where a per-line rule could read a stray one as content.
		['CRLF', '> hi\r\n', '\r\n']
	])('a blockquote with a trailing empty paragraph (%s)', (_label, source, lineEnding) => {
		// Enter at the end of "hi": the split writes the separator, then the empty half.
		const bq = parse(source).children[0];
		bq.children!.push({ kind: 'paragraph', leadingTrivia: lineEnding, raw: lineEnding });
		rebuildContainerRaw(bq);
		expect(parseConverges(docOf([bq]))).toBe(true);
	});

	it('an empty split half at the top level', () => {
		// Enter at offset 0 leaves a leading empty paragraph, now a block of its own.
		const doc = docOf([
			emptyParagraph(),
			{ kind: 'paragraph', leadingTrivia: '', raw: 'content\n' }
		]);
		expect(parseConverges(doc)).toBe(true);
	});

	it('an empty paragraph padded with spaces and tabs keeps its bytes', () => {
		const doc = docOf([
			{ kind: 'paragraph', leadingTrivia: '', raw: ' \t \n' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'content\n' }
		]);
		expect(parseConverges(doc)).toBe(true);
	});
});

// ── Caught divergence classes (the three bugs the tautology admitted) ─────────

describe('parseConverges catches live-tree-vs-raw divergence', () => {
	it('a stale kind: a paragraph whose raw serializes to a heading', () => {
		const doc = docOf([{ kind: 'paragraph', leadingTrivia: '', raw: '# x\n' }]);
		expect(parseConverges(doc)).toBe(false);
		expect(describeConvergence(doc)).toMatch(/kind "paragraph" != reparsed "heading"/);
		expect(() => expectParseConverged(doc)).toThrow(/kind "paragraph"/);
	});

	it('a nested stale kind (join-paste-stale-kind shape): a blockquote child that reparses to a heading', () => {
		const bq: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '> ## H\n',
			metadata: { quoteDepth: 1 },
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: '## H\n' }]
		};
		const doc = docOf([bq]);
		expect(parseConverges(doc)).toBe(false);
		expect(describeConvergence(doc)).toMatch(/kind "paragraph" != reparsed "heading"/);
	});

	it('a grid divergence (typed-cell-pipe shape): a body row with an extra live cell', () => {
		const doc = parse('| a | b |\n| --- | --- |\n| c | d |\n');
		// A live-grid desync the serializer is blind to. Cells are never filtered, so the
		// oracle fires where a byte round-trip would not.
		doc.children[0].children![1].children!.push({ kind: 'tableCell', leadingTrivia: '', raw: 'X' });
		expect(parseConverges(doc)).toBe(false);
	});

	it('a split that produced two paragraphs where the bytes reparse as one', () => {
		// A non-breaking space is content (GFM §2.1), so the second half is no separator
		// and the two halves reparse as one lazily-continued paragraph.
		const doc = docOf([
			{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' },
			{ kind: 'paragraph', leadingTrivia: '', raw: `${String.fromCharCode(0xa0)}\n` }
		]);
		expect(parseConverges(doc)).toBe(false);
		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 1/);
	});

	it('a stale table metadata columnCount fires on the parse-derived field', () => {
		const doc = parse('| a | b |\n| --- | --- |\n| c | d |\n');
		(doc.children[0].metadata as { columnCount: number }).columnCount = 3;
		expect(parseConverges(doc)).toBe(false);
		expect(describeConvergence(doc)).toMatch(/table\.columnCount/);
	});
});

// ── The filter stays out of the grid ──────────────────────────────────────────

describe('parseConverges keeps empty grid cells (only paragraph placeholders drop)', () => {
	it('a table with empty cells converges', () => {
		const doc = parse('| a | b |\n| --- | --- |\n|  |  |\n');
		expect(parseConverges(doc)).toBe(true);
	});
});
