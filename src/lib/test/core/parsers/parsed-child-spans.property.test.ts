// A parsed quote and a parsed table keep where each child's bytes sit in theirs, as a parsed list
// does, so a keystroke's rebuild and the byte splice find a child without pairing every line.
// Each span is checked against the child's own bytes and against the spans a full rebuild writes.
import { beforeEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { splitLines } from '#lib/core/lines.js';
import { QUOTE_LINES } from '#lib/core/parsers/blockquote.js';
import { stripOpener, type ContainerLines } from '#lib/core/parsers/strip-container.js';
import {
	codecFromShape,
	FIRST_LINE,
	INNER_LINE,
	WRITES_LINES,
	type LineCodec
} from '#lib/core/strip-lines.js';
import { headedLines } from '#lib/schema/headed-lines.js';
import { rebuildStripRaw } from '#lib/schema/strip-rebuild.js';
import { rebuildTableRaw } from '#lib/schema/container-rebuilders.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { SYNTAX_PLUGINS } from '../../behavior/corpus';
import {
	arbHeadedDoc,
	arbIndentedDoc,
	arbQuoteDoc,
	arbTableDoc
} from '../../invariants/arbitraries/spanned';

const quoteLines = codecFromShape(QUOTE_LINES);
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
	const found = spanned(parse(source).children);
	expect(found.length, JSON.stringify(source)).toBeGreaterThan(0);
	for (const node of found) {
		const spans = node.childSpans;
		const rebuilt = { ...node, childSpans: undefined } as CstNode;
		if (node.kind === 'table') rebuildTableRaw(rebuilt);
		else writeContainerRaw(rebuilt, defaultGrammarView);
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
		['a quote in a list item', '- > a\n  >\n  > b\n'],
		['a quote in an item of a quoted list', '> - > a\n>   >\n>   > b\n'],
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

describe('a quote inside a plugin block keeps its child spans', () => {
	beforeEach(() => installPlugins(SYNTAX_PLUGINS));

	it('in a details body', () => {
		expectSpansHold('<details>\n<summary>t</summary>\n\n> a\n>\n> b\n\n</details>\n');
	});
});

// ── Every shape the strip reader reads ───────────────────────────────────────

const HEADED: ContainerLines<{ type: string }> = {
	...QUOTE_LINES,
	head: {
		match: /^\[!(\w+)\]$/,
		data: (match) => ({ type: match[1] }),
		write: (data) => `[!${data.type}]`
	}
};

const INDENTED: ContainerLines<{ label: string }> = {
	shape: 'indented',
	open: /^\[\^(\w+)\]: ?/,
	data: (match) => ({ label: match[1] }),
	first: (data) => `[^${data.label}]: `,
	rest: () => '    ',
	lazy: true
};

/** `source`'s first block as the strip reader opens it under `lines`. */
function opened<D>(lines: ContainerLines<D>, source: string): CstNode {
	const parsed = splitLines(source);
	const reader = stripOpener('blockquote', lines, 0, true);
	return reader.tryOpen({
		lines: parsed,
		index: 0,
		end: parsed.length,
		line: parsed[0],
		leadingTrivia: '',
		isDocumentParse: false,
		depth: 0,
		grammar: defaultGrammarView
	})!.node;
}

/** The line syntax `node` was opened under, and its bytes written whole by that shape's writer. */
function rewritten<D>(
	lines: ContainerLines<D>,
	node: CstNode
): { codec: LineCodec; node: CstNode } {
	const rebuilt = { ...node, childSpans: undefined } as CstNode;
	if (lines.shape === 'indented') {
		const codec = codecFromShape(lines, lines.data(lines.open.exec(node.raw)!));
		rebuildStripRaw(rebuilt, codec, { grammar: defaultGrammarView });
		return { codec, node: rebuilt };
	}
	if ('head' in lines) headedLines(lines)[WRITES_LINES](rebuilt, defaultGrammarView);
	else rebuildStripRaw(rebuilt, codecFromShape(lines), { grammar: defaultGrammarView });
	return { codec: codecFromShape(lines), node: rebuilt };
}

/** The spans of `source`'s container hold each child's lines and are the ones its writer writes. */
function expectStripSpansHold<D>(lines: ContainerLines<D>, source: string): void {
	const node = opened(lines, source);
	const { codec, node: rebuilt } = rewritten(lines, node);
	const spans = node.childSpans;
	const rawLines = splitLines(node.raw);
	const lazy = rawLines.some((line, i) => codec.read(line.text, place(i))?.lazy === true);
	if (!spans && (lazy || rebuilt.raw !== node.raw || node.children!.length === 0)) return;
	expect(spans, JSON.stringify(node.raw)).toBeInstanceOf(Uint32Array);
	node.children!.forEach((child, i) => {
		const from = spans![i * 2];
		const first = lines.shape === 'indented' && from === 0;
		const read = splitLines(node.raw.slice(from, spans![i * 2 + 1]))
			.map((line, at) => codec.read(line.text, place(first ? at : 1))!.text + line.lineEnding)
			.join('');
		expect(read, JSON.stringify(node.raw)).toBe(child.leadingTrivia + child.raw);
	});
	if (rebuilt.childSpans) expect(Array.from(spans!)).toEqual(Array.from(rebuilt.childSpans));
	expect(rebuilt.raw, JSON.stringify(node.raw)).toBe(node.raw);
}

const place = (line: number) => (line === 0 ? FIRST_LINE : INNER_LINE);

describe('every container the strip reader opens keeps its child spans', () => {
	it.each([
		['under a head line', HEADED, '> [!NOTE]\n> a\n>\n> b\n', [10, 14, 14, 20]],
		['under a head line and a blank one', HEADED, '> [!NOTE]\n>\n> a\n>\n> b\n', [12, 16, 16, 22]],
		['indented', INDENTED, '[^n]: a\n\n    b\n', [0, 8, 8, 15]],
		// The generators draw no tab, so a tab in the marker column and CRLF under a head sit here.
		[
			'under a head line, a tab for the space',
			HEADED,
			'> [!NOTE]\n>\ta\n>\n>\tb\n',
			[10, 14, 14, 20]
		],
		['under a head line, CRLF', HEADED, '> [!NOTE]\r\n>\r\n> a\r\n> \r\n> b\r\n', [14, 19, 19, 28]],
		['indented by a tab', INDENTED, '[^n]: a\n\n\tb\n', [0, 8, 8, 12]]
	] as const)('%s', (_name, lines, source, spans) => {
		expect(Array.from(opened(lines as ContainerLines<unknown>, source).childSpans!)).toEqual(spans);
		expectStripSpansHold(lines as ContainerLines<unknown>, source);
	});

	it.each([
		['under a head line', HEADED, arbHeadedDoc],
		['indented', INDENTED, arbIndentedDoc]
	] as const)('over generated containers %s', (_name, lines, docs) => {
		fc.assert(
			fc.property(docs, (source) => expectStripSpansHold(lines as ContainerLines<unknown>, source)),
			{ numRuns: 300, seed: freshOrFixedSeed(20261109) }
		);
	});
});
