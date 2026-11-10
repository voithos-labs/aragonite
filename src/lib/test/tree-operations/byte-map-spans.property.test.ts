// The byte map answers alike with a quote's or a table's child spans and without them: a question
// about one child pairs that child's lines alone and must land where pairing every line lands, at
// every byte, every block offset, every child's blank lines and every gap caret boundary.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { childTriviaStart, documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { gapAtByte } from '#lib/selection/range-bytes.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbLawDocument } from '../range-laws/shapes';
import { allBlockPaths, freshOrFixedSeed } from '../invariants/arbitraries/index';
import { arbQuoteDoc, arbTableDoc } from '../invariants/arbitraries/spanned';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const withoutSpans = (node: CstNode): CstNode =>
	({ ...node, childSpans: undefined, children: node.children?.map(withoutSpans) }) as CstNode;

/** Every answer the byte map gives about `doc`, one line each. */
function answers(doc: Document): string[] {
	const map = documentByteMap(measured(doc));
	const out: string[] = [];
	for (let at = 0; at <= serialize(doc).length; at++) {
		out.push(
			`byte ${at}: ${JSON.stringify(map.leafAt(at))}, gap ${JSON.stringify(gapAtByte(measured(doc), at))}`
		);
	}
	for (const path of allBlockPaths(doc)) {
		const node = blockNodeAt(doc, path)!;
		for (let offset = -1; offset <= node.raw.length + 1; offset++) {
			out.push(`${path.join('.')}@${offset}: ${map.byteOf(path, offset)}`);
		}
		const container = map.containerMap(node);
		node.children?.forEach((_, i) => {
			out.push(
				`${path.join('.')} child ${i}: ${container && childTriviaStart(container, node, i)}`
			);
		});
	}
	return out;
}

/** `doc`'s answers against those of the same document with every span taken off. */
function expectAnswersWithoutSpans(doc: Document, label: string): void {
	const spanned = answers(doc);
	const whole = answers({ ...doc, children: doc.children.map(withoutSpans) });
	const misses = spanned.filter((answer, i) => answer !== whole[i]);
	expect(misses.slice(0, 5), `${label} against ${whole.length} answers`).toEqual([]);
}

const opened = (source: string) => {
	installPlugins(SYNTAX_PLUGINS);
	return readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' });
};

const expectSpansChangeNothing = (source: string) =>
	expectAnswersWithoutSpans(opened(source), JSON.stringify(source));

describe('child spans change no byte map answer', () => {
	it.each([
		['blank lines between children', '> a\n>\n> b\n>\n>\n> c\n'],
		['trailing blank lines', '> a\n>\n> b\n>\n>\n\nafter\n'],
		['a lazy line', '> a\nlazy\n> b\n'],
		['a nested quote', '> a\n>\n> > b\n> > c\n>\n> d\n'],
		['a list in a quote', '> a\n>\n> - one\n> - two\n>\n> b\n'],
		['code in a quote', '> a\n>\n>     code\n>     more\n> b\n'],
		['a tab after the marker', '>\ta\n>\n>\t\tcode\n> b\n'],
		['no final line break', '> a\n>\n> b'],
		['CRLF', '> a\r\n>\r\n> b\r\n\r\nafter\r\n'],
		['an alert', '> [!NOTE]\n> alpha\n>\n> beta\n\nafter\n'],
		['a table', '| a | b |\n|---|---|\n| 1 |  |\n| x | y |\n\nafter\n'],
		['a table with no final line break', '| h |\n| - |\n| a |\n| b |'],
		['a row with no pipes', '| a | b |\n|---|---|\nplain\n| c | d |\n'],
		['a table in a quote', '> | a |\n> | - |\n> | b |\n> | c |\n']
	])('%s', (_, source) => expectSpansChangeNothing(source));

	it('reads past a span left from before a child grew', () => {
		const doc = opened('> a\n>\n> b and more\n>\n> c\n');
		doc.children[0].childSpans = opened('> a\n>\n> b\n>\n> c\n').children[0].childSpans;
		expectAnswersWithoutSpans(doc, 'a stale span');
	});
	it('over generated documents', () => {
		fc.assert(
			fc.property(fc.oneof(arbQuoteDoc, arbTableDoc, arbLawDocument), expectSpansChangeNothing),
			{ numRuns: 300, seed: freshOrFixedSeed(20261108) }
		);
	});
});
