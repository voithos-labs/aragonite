// A document whose bytes change becomes, through the splice reading, the tree opening the new bytes
// gives: anywhere in the document, for every syntax the bundled plugins add, whatever a change
// merges into or swallows, one change or several; and the blocks no change reached keep their ids.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { changesBetween, type ByteChange } from '#lib/tree-operations/byte-changes.js';
import { reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbLawDocument } from '../range-laws/shapes';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

// The editor opens an empty file as one empty paragraph.
const open = (source: string): Document => initDocument(source, defaultGrammarView).doc;

const applied = (source: string, changes: readonly ByteChange[]) =>
	changes.reduceRight((text, c) => text.slice(0, c.from) + c.insert + text.slice(c.to), source);

/** `source` opened, then spliced by `changes`; the document and the blocks it held before. */
function splice(source: string, changes: (before: string) => ByteChange[]) {
	installPlugins(SYNTAX_PLUGINS);
	const doc = open(source);
	assignChildIdsDeep({
		kind: 'document',
		leadingTrivia: '',
		raw: '',
		children: doc.children
	} as CstNode);
	const kept = [...doc.children];
	const before = serialize(doc);
	const made = changes(before);
	const reading = spliceReading(measured(doc), before, made, defaultGrammarView);
	for (const window of [...(reading?.windows ?? [])].reverse()) {
		doc.children.splice(window.at, window.count, ...window.blocks);
	}
	if (reading) doc.suffix = reading.suffix;
	return { doc, kept, reading, after: applied(before, made) };
}

function divergence(source: string, changes: (before: string) => ByteChange[]): string | null {
	const { doc, after } = splice(source, changes);
	const bytes = serialize(doc);
	if (bytes !== after) return `bytes ${JSON.stringify(bytes)}, not ${JSON.stringify(after)}`;
	return after === '' ? null : reloadDivergence(doc, after);
}

const to = (after: string) => (before: string) => changesBetween(before, after);

/** An ordered list of `count` one-letter items. */
const ITEMS = (count: number) =>
	Array.from({ length: count }, (_, i) => `${i + 1}. ${'abcdefghij'[i]}\n`).join('');

/** What an edit types: the openers and closers that reach past their own line, and plain text. */
const INSERTS = [
	'```\n',
	'~~~js\n',
	'> ',
	'- ',
	'1. ',
	'  ',
	'\t',
	'\n',
	'\n\n',
	'===\n',
	'---\n',
	'| a |\n|---|\n',
	':::note\n',
	':::\n',
	'<details>\n<summary>S</summary>\n',
	'</details>\n',
	'<details>\n<summary>S</summary>\n</details>\n',
	'[^1]: ',
	'$$\n',
	'x',
	':',
	'two words',
	'**',
	''
];

/** Lines that open or close a block apart from each other, so a closer sits far from its opener. */
const arbLinesApart = fc
	.tuple(
		fc.array(fc.constantFrom('a', '- x', '  y', '> q', '```', ':::note', ':::', '::', '$$', ''), {
			minLength: 1,
			maxLength: 12
		}),
		fc.constantFrom('\n', '\r\n')
	)
	.map(([lines, ending]) => lines.join(ending) + ending);

/** One to three disjoint changes, each at a spot drawn over the document; some close together, so
 *  their windows meet. */
const arbEdit = fc.record({
	source: fc.oneof(arbLawDocument, arbLinesApart),
	spots: fc.array(
		fc.record({
			at: fc.double({ min: 0, max: 1, noNaN: true }),
			span: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.3, noNaN: true })),
			insert: fc.constantFrom(...INSERTS)
		}),
		{ minLength: 1, maxLength: 3 }
	)
});

/** The drawn spots as sorted changes to `before`, each kept clear of the one before it. */
function changesAt(before: string, spots: { at: number; span: number; insert: string }[]) {
	// A cut between `\r` and `\n` writes a lone `\r`, which no edit writes.
	const whole = (n: number) => (before[n - 1] === '\r' && before[n] === '\n' ? n - 1 : n);
	const changes: ByteChange[] = [];
	let floor = 0;
	for (const spot of [...spots].sort((a, b) => a.at - b.at)) {
		const from = whole(Math.max(floor, Math.floor(spot.at * before.length)));
		const end = whole(Math.min(before.length, from + Math.floor(spot.span * before.length)));
		if (from < floor || end < from) continue;
		changes.push({ from, to: end, insert: spot.insert });
		floor = end;
	}
	return changes;
}

describe('a splice reads as the document it leaves', () => {
	it('anywhere, one change or several, whatever each merges into or swallows', () => {
		fc.assert(
			fc.property(arbEdit, ({ source, spots }) => {
				expect(divergence(source, (before) => changesAt(before, spots))).toBeNull();
			}),
			{ numRuns: 300, seed: freshOrFixedSeed(20261106) }
		);
	});

	it.each([
		['an unclosed fence at the top swallows the rest', 'a\n\nb\n\n- c\n', '```\na\n\nb\n\n- c\n'],
		[
			'a setext underline turns the paragraph above into a heading',
			'Title\n\nnext\n',
			'Title\n---\n\nnext\n'
		],
		['a lazy line joins the quote above', '> q\n\nlazy\n', '> q\nlazy\n'],
		['a removed blank line merges two paragraphs', 'one\n\ntwo\n\nthree\n', 'one\ntwo\n\nthree\n'],
		['an indent joins the list across blank lines', '- x\n\n\nb\n', '- x\n\n\n  b\n'],
		['text in a blank block moves the separator', 'a\n\n\n\nb\n', 'a\n\nx\n\nb\n'],
		['a delimiter row makes a table of the paragraph above', 'h\n\nafter\n', 'h\n|-|\n\nafter\n'],
		['CRLF and no final line break', 'a\r\n\r\nb', 'a\r\nx\r\n\r\nb'],
		['an emptied document', 'a\n\nb\n', ''],
		['a closed fence below stays closed', '```\na\n```\n\nb\n', '```\na\n```\n\nbc\n'],
		['a blank line splits a list, its first item kept', '- a\n- b\n- c\n', '- a\n\n- b\n- c\n'],
		['a tenth item widens the marker column', ITEMS(9), `${ITEMS(9)}10. j\n`],
		// Miss-analysis: the generator drew openers and closers, never one far from the other.
		['an opener finds its closer far below', 'a\n\nb\n\n:::\n', ':::note\na\n\nb\n\n:::\n'],
		[
			'a details opener finds its closing tag far below',
			'a\n\nb\n\n</details>\n',
			'<details>\n<summary>S</summary>\na\n\nb\n\n</details>\n'
		],
		[
			'a closer far below finishes the opener above',
			':::note\na\n\nb\n\nc\n',
			':::note\na\n\nb\n\nc\n:::\n'
		],
		['a math closer far below finishes the opener', '$$\na\n\nb\n\nc\n', '$$\na\n\nb\n\nc\n$$\n'],
		[
			'a closer finished mid-line under CRLF',
			':::note\r\na\r\n\r\nb\r\n\r\n::\r\n',
			':::note\r\na\r\n\r\nb\r\n\r\n:::\r\n'
		],
		[
			'an opener typed above a directive takes its closer',
			'<details>\n<summary>S</summary>\n</details>\n\n:::note\n:::\n',
			':::note\n<details>\n<summary>S</summary>\n</details>\n\n:::note\n:::\n'
		]
	])('%s', (_name, before, after) => {
		expect(divergence(before, to(after))).toBeNull();
	});

	it('reads two far-apart changes as two windows, and two that meet as one', () => {
		const source = 'a\n\nb\n\nc\n\nd\n\ne\n';
		const apart = splice(source, () => [
			{ from: 0, to: 1, insert: 'A' },
			{ from: 12, to: 13, insert: 'E' }
		]);
		expect(apart.reading?.windows.map((w) => [w.at, w.count])).toEqual([
			[0, 1],
			[4, 1]
		]);
		// A fence opened in the first change runs on into the second's window.
		const meeting = () => [
			{ from: 0, to: 0, insert: '```\n' },
			{ from: 6, to: 7, insert: 'C' }
		];
		expect(divergence(source, meeting)).toBeNull();
		expect(splice(source, meeting).reading?.windows).toHaveLength(1);
	});

	it('no change needs no splice', () => {
		expect(splice('a\n', to('a\n')).reading).toBeNull();
	});
});

describe('a splice keeps the blocks the change did not reach', () => {
	it('leaves the top-level blocks around the change as they were', () => {
		const { doc, kept, reading } = splice('one\n\ntwo\n\nthree\n', to('one\n\ntwX\n\nthree\n'));
		expect(reading?.windows).toMatchObject([{ at: 1, count: 1 }]);
		expect(doc.children[0]).toBe(kept[0]);
		expect(doc.children[2]).toBe(kept[2]);
	});

	it('keeps the ids of the items around a change inside a list, at every depth', () => {
		const before = '- a\n- b\n  - c\n  - d\n- e\n';
		const { doc, kept } = splice(before, to('- a\n- b\n  - cX\n  - d\n- e\n'));
		const [list, oldList] = [doc.children[0], kept[0]];
		expect(list.childIds).toEqual(oldList.childIds);
		const nested = (node: CstNode) => node.children![1].children![1];
		expect(nested(list).childIds).toEqual(nested(oldList).childIds);
	});

	// Miss-analysis: the depth test changed the last nested item, so no unchanged item held children.
	it('keeps the ids inside an unchanged item beside the change', () => {
		const { doc, kept } = splice('- a\n  - x\n  - y\n- b\n', to('- a\n  - x\n  - y\n- bX\n'));
		const ids = (node: CstNode) => [node.childIds, node.children![1].childIds];
		expect(ids(doc.children[0].children![0])).toEqual(ids(kept[0].children![0]));
	});
});
