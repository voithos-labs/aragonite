import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode, Document } from '$lib/core/nodes';
import {
	assembleListHalf,
	buildListItemWithContent
} from '$lib/tree-operations/list/list-builders';
import {
	expectParseConverged,
	parseConverges,
	describeConvergence
} from '$lib/test/harness/parse-converged';

// The belt for the belt: parse-convergence is only worth wiring at every vacuous
// round-trip site if it (a) catches the live-tree-vs-raw divergence the byte
// round-trip is blind to, and (b) tolerates exactly the editor's legal empty
// placeholder transients — no more, no less. Both directions are pinned here.

function docOf(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

function emptyParagraph(): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
}

// ── Tolerated transients (mirrors stale-raw.test.ts's placeholder list) ───────
// Each is a live shape the parser folds into trivia on reparse; the oracle drops
// empty-paragraph placeholders on both sides so none reads as divergence.

describe('parseConverges tolerates the documented empty-paragraph placeholders', () => {
	it('an empty list item holding an empty-paragraph placeholder', () => {
		const listTemplate = parse('- a\n').children[0];
		const emptyItem = buildListItemWithContent(listTemplate.children![0], [emptyParagraph()]);
		const list = assembleListHalf(listTemplate, [emptyItem], 1);
		expect(list.raw).toBe('- \n'); // childless in the parser's eyes; a placeholder leaf here
		expect(parseConverges(docOf([list]))).toBe(true);
	});

	it.each([
		['LF', '> hi\n>\n'],
		// CRLF puts the `\r` in the line's ending, not its text, so the blank test
		// still sees an empty line — the one path where a per-line rule could have
		// read a stray `\r` as content.
		['CRLF', '> hi\r\n>\r\n']
	])('a blockquote with a trailing empty-paragraph placeholder (%s)', (_label, source) => {
		const bq = parse(source).children[0];
		const trailingBlank = bq.innerSuffix ?? '';
		bq.innerSuffix = '';
		bq.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: trailingBlank });
		expect(parseConverges(docOf([bq]))).toBe(true);
	});

	it('an empty split half at the top level', () => {
		// Enter at offset 0 leaves a leading empty paragraph the parser folds to prefix.
		const doc = docOf([
			emptyParagraph(),
			{ kind: 'paragraph', leadingTrivia: '', raw: 'content\n' }
		]);
		expect(parseConverges(doc)).toBe(true);
	});

	it('a placeholder padded with spaces and tabs, which the parser also folds', () => {
		// Guards the tolerance against being narrowed to exact-empty: the parser
		// calls this line blank, so the oracle must keep tolerating it.
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
		// Plant a cell into the body row without touching table.raw — the live-grid
		// desync the serializer is blind to. Cells are never filtered, so it fires.
		doc.children[0].children![1].children!.push({ kind: 'tableCell', leadingTrivia: '', raw: 'X' });
		expect(parseConverges(doc)).toBe(false);
	});

	it('a split that produced two paragraphs where the bytes reparse as one', () => {
		// The tolerance is "the parser folds this line into trivia", so it has to ask
		// the parser's own blank rule. A `String.trim()` test called this non-breaking
		// space blank, dropped the second paragraph from the LIVE side only, and
		// reported convergence for a live tree that is genuinely one node too long.
		const doc = docOf([
			{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' },
			{ kind: 'paragraph', leadingTrivia: '', raw: `${String.fromCharCode(0xa0)}\n` }
		]);
		expect(parseConverges(doc)).toBe(false);
		expect(describeConvergence(doc)).toMatch(/live has 2 comparable children, reparsed has 1/);
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
