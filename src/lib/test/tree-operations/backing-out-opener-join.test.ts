// A join's one-line read is trusted only where no block above the cut has a reading that isn't
// final (an unclosed `$$` left as a paragraph), since lines below can still complete it.
// Miss-analysis: the rows pinning the one-line read wrote under blocks whose reading ends at their
// own last line, so no row put a backed-out `$$` or `:::` above a block that later closes it.
import { describe, it, expect, beforeEach } from 'vitest';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { installPlugins } from '#lib';
import { OPENER_PRIORITIES, type BlockOpener, type BlockOpenerResult } from '#lib/plugin.js';
import { parse } from '#lib/core/parser.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite, updateNodeContent } from '#lib/tree-operations/content-write.js';
import {
	makeEditorActionsDeps,
	makeNestedHarness,
	makeTopHarness
} from '#lib/test/harness/editor-actions.js';
import { createTopLevelScope } from '#lib/editor-actions/block-edit-scope.js';
import { commitLeafText } from '#lib/editor-actions/block-edit-core.js';
import { describeConvergence, expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { serialize } from '#lib/core/serializer.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';

/** The top-level kinds after `text` is written over block `index` through the keystroke route. */
function typedOverSecond(source: string, text: string, index = 1): string[] {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createUndoController(deps);
	const write = legalizeWrite(deps.doc, index, text, 'authored', defaultGrammarView);
	expect(typing.typeLeaf(docPathFrom([index]), write, 0).wrote).toBe(true);
	expectParseConverged(deps.doc);
	return deps.doc.children.map((c) => c.kind);
}

describe('a construct backed out above a join completes once a write below closes it', () => {
	beforeEach(() => {
		installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
	});

	it.each([
		['a `$$` block', '$$\n<div>\nx\n', '<div>\n$$\n'],
		['a `:::note` block', ':::note\n<div>\nx\n', '<div>\n:::\n']
	])('%s backed out over a flush HTML block takes it in', (_label, source, text) => {
		expect(typedOverSecond(source, text)).toHaveLength(1);
	});

	// The construct reads on past blank lines for its closer, so the join above is asked across them.
	it.each([
		['a `$$` block', '$$\n\n<div>\nx\n', '<div>\n$$\n'],
		['a `:::note` block', ':::note\n\n<div>\nx\n', '<div>\n:::\n'],
		[
			'a `<details>` block',
			'<details>\n<summary>s</summary>\nx\n\n<div>\ny\n',
			'<div>\n</details>\n'
		]
	])('%s backed out a blank line above takes in the block that closes it', (_l, source, text) => {
		expect(typedOverSecond(source, text)).toHaveLength(1);
	});

	// `$$` cuts a paragraph off, so a backed-out one always starts a block: the first line is the
	// only line of the block above the check has to read.
	it('a `$$` typed under paragraph text starts its own block and takes in the closer below', () => {
		expect(typedOverSecond('p\n$$\n<div>\nx\n', '<div>\n$$\n', 2)).toEqual([
			'paragraph',
			'mathBlock'
		]);
	});
});

// ── What leaving the declaration out costs ───────────────────────────────────

/** A `fence`-bounded block that, unclosed, backs out to paragraphs, as `$$` does. */
function fencedOpener(kind: string, fence: string, declared: boolean): BlockOpener {
	const awaitsCloser = (raw: string) => {
		const [opener, ...rest] = raw.split('\n');
		return opener === fence && !rest.includes(fence);
	};
	return {
		priority: OPENER_PRIORITIES.fencedCode + 7,
		interruptsParagraph: (line) => line === fence,
		...(declared
			? {
					readingNotFinal: {
						notFinal: awaitsCloser,
						mayClose: (line: string) => line === fence,
						closer: () => fence
					}
				}
			: {}),
		tryOpen(ctx): BlockOpenerResult | null {
			if (ctx.line.text !== fence) return null;
			let close = ctx.index + 1;
			while (close < ctx.end && ctx.lines[close].text !== fence) close++;
			if (close >= ctx.end) return null;
			const raw = ctx.lines
				.slice(ctx.index, close + 1)
				.map((line) => line.raw)
				.join('');
			const node = { kind, leadingTrivia: ctx.leadingTrivia, raw } as CstNode;
			return { node, consumed: close + 1 - ctx.index };
		}
	};
}

describe('a backing-out opener that leaves its declaration out', () => {
	beforeEach(() => {
		testLeaf('undeclared', { opener: fencedOpener('undeclared', '%%%', false) });
		testLeaf('declared', { opener: fencedOpener('declared', '@@@', true) });
	});

	it('leaves its own shape two blocks where a reload reads one', () => {
		const doc = parse('%%%\n<div>\nx\n');
		updateNodeContent(doc, 1, '<div>\n%%%\n', defaultGrammarView, createSharingState());

		expect(describeConvergence(doc)).toBe('[] live has 2 children, reparsed has 1');
	});

	it('and nothing else: the same write converges once the opener declares it', () => {
		expect(typedOverSecond('@@@\n<div>\nx\n', '<div>\n@@@\n')).toEqual(['declared']);
		expect(typedOverSecond('foo\n<div>\n', '<span>\n')).toEqual(['paragraph']);
	});
});

// ── A closer blocks below the construct it finishes ──────────────────────────
// Miss-analysis: every row put the closer in the block right under the construct, or one blank
// line under it, so no merge had a block between to stop at.

type Route = (source: string) => {
	doc: Document;
	write: (index: number, text: string) => Promise<unknown>;
	split: (index: number, offset: number) => Promise<unknown>;
};

/** Both routes a block's new text lands by: a commit, and the keystroke written in place. */
const ROUTES: [string, Route][] = [
	[
		'through a commit',
		(source) => {
			const h = makeTopHarness(source);
			const scope = createTopLevelScope(h.deps, h.controller);
			return {
				doc: h.deps.doc,
				write: (index, text) =>
					commitLeafText(
						scope,
						index,
						legalizeWrite(scope.target(), index, text, 'authored', defaultGrammarView),
						{
							snapshotOffset: 0,
							caret: 0
						}
					),
				split: (index, offset) => h.actions.splitBlock(index, offset)
			};
		}
	],
	[
		'written in place',
		(source) => {
			const h = makeTopHarness(source);
			const typing = h.controller;
			return {
				doc: h.deps.doc,
				write: async (index, text) =>
					typing.typeLeaf(
						docPathFrom([index]),
						legalizeWrite(h.deps.doc, index, text, 'authored', defaultGrammarView),
						0
					),
				split: (index, offset) => h.actions.splitBlock(index, offset)
			};
		}
	]
];

describe.each(ROUTES)('a closer written blocks below the construct it finishes, %s', (_, route) => {
	beforeEach(() => {
		installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
	});

	it.each([
		['a `:::note`', ':::note\n<div>\n\nx\n', ':::\n', 'admonition'],
		['a `$$`', '$$\n<div>\n\nx\n', '$$\n', 'mathBlock'],
		['a `:::note` past two blocks', ':::note\n\none\n\n<div>\n\nx\n', ':::\n', 'admonition']
	])('%s takes in every block down to the closer', async (_l, source, text, kind) => {
		const { doc, write } = route(source);
		await write(doc.children.length - 1, text);
		expect(doc.children.map((c) => c.kind)).toEqual([kind]);
		expectParseConverged(doc);
	});

	// An opener a write puts on a line of its own gets its own closer, as a typed fence does, so a
	// closer already below stays the block it was.
	it.each([
		['a `$$$` shortened to `$$`', '$$$\n\nx\n\n$$\n', 0, '$$\n', '$$\n$$\n\nx\n\n$$\n'],
		[
			'a `$$` written under paragraph text',
			'a\n\nx\n\n$$\n',
			0,
			'a\n$$\n',
			'a\n$$\n$$\n\nx\n\n$$\n'
		],
		[
			'a `$$` above two `$$` blocks',
			'x$$\n\na\n\n$$\nm\n$$\n\nb\n\n$$\nn\n$$\n',
			0,
			'$$\n',
			'$$\n$$\n\na\n\n$$\nm\n$$\n\nb\n\n$$\nn\n$$\n'
		],
		[
			'a `::::note` shortened to `:::note`',
			'::::note\n\nx\n\n:::\n',
			0,
			':::note\n',
			':::note\n:::\n\nx\n\n:::\n'
		],
		[
			'a `:::note` written under paragraph text',
			'a\n\nx\n\n:::\n',
			0,
			'a\n:::note\n',
			'a\n:::note\n:::\n\nx\n\n:::\n'
		],
		[
			'a `::::note` above a `:::` it refuses',
			'x::::note\n\na\n\n:::\n\nb\n\n::::\n',
			0,
			'::::note\n',
			'::::note\n::::\n\na\n\n:::\n\nb\n\n::::\n'
		]
	])('%s gets its own closer', async (_l, source, index, text, expected) => {
		const { doc, write } = route(source);
		await write(index, text);
		expect(serialize(doc)).toBe(expected);
		expectParseConverged(doc);
	});

	it('Enter that puts a `$$` on a line of its own closes the `$$` above', async () => {
		const { doc, split } = route('$$\n\nfoo\n\nx $$\n');
		await split(2, 2);
		expect(doc.children[0].kind).toBe('mathBlock');
		expectParseConverged(doc);
	});

	it('a line that closes nothing below an unclosed `$$` leaves it waiting', async () => {
		const { doc, write } = route('$$\n\nfoo\n\nbar\n');
		await write(2, 'bars\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
		expectParseConverged(doc);
	});
});

// A body below the document closes a written opener the same way, through the keystroke's own route.
describe('an opener made by a write inside a quote', () => {
	beforeEach(() => {
		installPlugins([latexPlugin(), admonitionsPlugin()]);
	});

	it.each([
		[
			'above two `$$` blocks',
			'> x$$\n>\n> a\n>\n> $$\n> m\n> $$\n>\n> b\n>\n> $$\n> n\n> $$\n',
			'> $$\n> $$\n>\n> a\n>\n> $$\n> m\n> $$\n>\n> b\n>\n> $$\n> n\n> $$\n'
		],
		[
			'above a `:::` it refuses',
			'> x::::note\n>\n> a\n>\n> :::\n>\n> b\n>\n> ::::\n',
			'> ::::note\n> ::::\n>\n> a\n>\n> :::\n>\n> b\n>\n> ::::\n'
		]
	])('gets its own closer %s', async (_l, source, expected) => {
		const h = makeNestedHarness(source, { index: 0 });
		const raw = h.deps.doc.children[0].children![0].raw;
		await h.bundle.blockEdit.updateBlockContent(0, raw.slice(1), 'authored', 'join-typing', 1, 0);
		expect(serialize(h.deps.doc)).toBe(expected);
		expectParseConverged(h.deps.doc);
	});
});

// A definition ends at a blank line, so its `mayClose` refuses every line: the flush shapes that
// still finish one are the flush join's, asked on every write beside it.
describe('a backed-out link definition', () => {
	it.each([
		['its destination', '[foo]:\n\n# h\n', 1, '/url\n'],
		['its title', '[foo]: /url\n\n# h\n', 1, '"title"\n'],
		['its destination, flush', '[foo]:\n# h\n', 1, '/url\n'],
		['its title, flush', '[foo]: /url\n# h\n', 1, '"title"\n']
	])('reads as a reload does once the block below becomes %s', async (_l, source, index, text) => {
		for (const [, route] of ROUTES) {
			const { doc, write } = route(source);
			await write(index, text);
			expectParseConverged(doc);
		}
	});
});
