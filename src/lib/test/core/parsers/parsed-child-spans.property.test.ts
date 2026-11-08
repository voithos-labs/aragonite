// A parsed quote and a parsed table keep where each child's bytes sit in theirs, as a parsed list
// does, so a keystroke's rebuild and the byte splice find a child without pairing every line.
// Each span is checked against the child's own bytes and against the spans a full rebuild writes.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { splitLines } from '#lib/core/lines.js';
import { quoteLines } from '#lib/core/parsers/blockquote.js';
import { INNER_LINE } from '#lib/core/strip-lines.js';
import { rebuildBlockquoteRaw, rebuildTableRaw } from '#lib/schema/container-rebuilders.js';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';

const quoteLine = fc.constantFrom(
	'> text',
	'> two words',
	'>',
	'> ',
	'> > nested',
	'> - item',
	'>     code',
	'> ```',
	'lazy line',
	'> wörld ☃'
);
const tableRow = fc.constantFrom('| a | b |', '| one |', '| x | y | z |', '|  |  |', 'a | b');

const arbQuote = fc
	.tuple(fc.array(quoteLine, { minLength: 1, maxLength: 14 }), fc.constantFrom('\n', '\r\n'))
	.chain(([lines, ending]) =>
		fc.boolean().map((closed) => '> first' + ending + lines.join(ending) + (closed ? ending : ''))
	);

const arbTable = fc
	.tuple(fc.array(tableRow, { maxLength: 12 }), fc.constantFrom('\n', '\r\n'), fc.boolean())
	.map(
		([rows, ending, closed]) =>
			['| h | i |', '| --- | :-: |', ...rows].join(ending) + (closed ? ending : '')
	);

const isLazy = (line: { text: string }) => quoteLines.read(line.text, INNER_LINE)?.lazy === true;

/** Every quote and table in `nodes`, however deep. */
function spanned(nodes: readonly CstNode[]): CstNode[] {
	return nodes.flatMap((node) => [
		...(node.kind === 'blockquote' || node.kind === 'table' ? [node] : []),
		...spanned(node.children ?? [])
	]);
}

/** The child's bytes as its region reads them: a quote's lines stripped of their markers. */
function regionReads(node: CstNode, region: string): string {
	if (node.kind === 'table') return region;
	return splitLines(region)
		.map((line) => (quoteLines.read(line.text, INNER_LINE)?.text ?? line.text) + line.lineEnding)
		.join('');
}

function expectSpansHold(source: string): void {
	for (const node of spanned(parse(source).children)) {
		const spans = node.childSpans;
		// A child opening on a lazy line leaves its quote's spans to the full rebuild.
		if (!spans && node.kind === 'blockquote' && splitLines(node.raw).some(isLazy)) continue;
		expect(spans, `${node.kind} ${JSON.stringify(node.raw)}`).toBeInstanceOf(Uint32Array);
		node.children!.forEach((child, i) => {
			const region = node.raw.slice(spans![i * 2], spans![i * 2 + 1]);
			expect(regionReads(node, region)).toBe(child.leadingTrivia + child.raw);
		});
		const rebuilt = { ...node, childSpans: undefined } as CstNode;
		if (node.kind === 'table') rebuildTableRaw(rebuilt);
		else rebuildBlockquoteRaw(rebuilt);
		if (rebuilt.childSpans) expect(Array.from(spans!)).toEqual(Array.from(rebuilt.childSpans));
	}
}

describe('a parsed quote and table keep their child spans', () => {
	it.each([
		['a quote of paragraphs', '> a\n>\n> b\n'],
		['a lazy line', '> a\nlazy\n> b\n'],
		['a nested quote', '> a\n> > b\n> > c\n'],
		['no final line break', '> a\n>\n> b'],
		['CRLF', '> a\r\n>\r\n> b\r\n'],
		['a table', '| h |\n| - |\n| a |\n| b |\n'],
		['a table with no body', '| h |\n| - |\n'],
		['a table with no final line break', '| h |\n| - |\n| a |']
	])('%s', (_name, source) => expectSpansHold(source));

	// Miss-analysis: the shape fixed point typed into a child opening on a lazy line; the region
	// rewrite gives that line a marker, which the full rebuild a spanless quote takes does not.
	it('leaves a quote with a child opening on a lazy line no spans', () => {
		const quote = parse('> x\n>\n>     code\nlazy\n').children[0];
		expect(quote.children!.at(-1)?.raw).toBe('lazy\n');
		expect(quote.childSpans).toBeUndefined();
	});

	it('over generated quotes and tables', () => {
		fc.assert(fc.property(fc.oneof(arbQuote, arbTable), expectSpansHold), {
			numRuns: 300,
			seed: freshOrFixedSeed(20261108)
		});
	});
});
