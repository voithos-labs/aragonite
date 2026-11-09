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
import { arbQuoteDoc, arbTableDoc } from '../../invariants/arbitraries/spanned';

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
		const rebuilt = { ...node, childSpans: undefined } as CstNode;
		if (node.kind === 'table') rebuildTableRaw(rebuilt);
		else rebuildBlockquoteRaw(rebuilt);
		// A child opening on a lazy line, or bytes a full rebuild leaves out, leave the quote's
		// spans to the full rebuild.
		const wholeOnly = splitLines(node.raw).some(isLazy) || rebuilt.raw !== node.raw;
		if (!spans && node.kind === 'blockquote' && wholeOnly) continue;
		expect(spans, `${node.kind} ${JSON.stringify(node.raw)}`).toBeInstanceOf(Uint32Array);
		node.children!.forEach((child, i) => {
			const region = node.raw.slice(spans![i * 2], spans![i * 2 + 1]);
			expect(regionReads(node, region)).toBe(child.leadingTrivia + child.raw);
		});
		if (rebuilt.childSpans) expect(Array.from(spans!)).toEqual(Array.from(rebuilt.childSpans));
		// A keystroke's region rewrite keeps every byte outside its child, so it only agrees with
		// the full rebuild where that writes the container back as it stands.
		expect(rebuilt.raw, JSON.stringify(node.raw)).toBe(node.raw);
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

	// Miss-analysis: the property held each span to its child and to the full rebuild's spans, but
	// never asked that rebuild for the bytes, which drops a last bare `>` holding none of the body.
	it.each([
		['a last bare marker', '> first\n>\n>'],
		['a last marker and space', '> first\n>\n> '],
		['CRLF', '> first\r\n> \r\n> '],
		['an open fence', '> first\n> ```\n> code\n>']
	])('leaves a quote ending on %s with no line break no spans', (_name, source) => {
		expect(parse(source).children[0].childSpans).toBeUndefined();
	});

	it('over generated quotes and tables', () => {
		fc.assert(fc.property(fc.oneof(arbQuoteDoc, arbTableDoc), expectSpansHold), {
			numRuns: 300,
			seed: freshOrFixedSeed(20261108)
		});
	});
});
