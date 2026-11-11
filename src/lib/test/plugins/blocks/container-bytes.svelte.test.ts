// @vitest-environment jsdom
// A plugin's container under a marker of its own, found in the document's bytes: every text
// position has its byte, and a range in it is cut and removed as the same range in a quote is,
// through the editor's routes and over the range-edit core's named rows.
// Miss-analysis: every byte map and removal row drew a built-in's or a bundled plugin's marker,
// which the map read by a pattern of its own, so no row held a marker only a line shape states.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { displayLength } from '#lib/core/lines.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { container } from '#lib/components/block-makers/container.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { SYNTAX_PLUGINS } from '../../behavior/corpus';
import { NAMED_ROWS, rangeOf, unmark } from '../../range-edit/named-rows';
import { noTransforms } from '../../range-edit/test-host';
import { allBlockPaths } from '../../invariants/arbitraries/index';
import { clipboardGesture, placeRange, type Editor } from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

/** A quote's lines under `%>`: the same indent before the marker, the same space or tab after. */
const BOX = {
	shape: 'marked',
	first: '%> ',
	rest: '%> ',
	reads: /^ {0,3}%>[ \t]?/,
	lazy: true
} as const;

/** One container type under each line shape, none of whose markers a built-in writes; `quiet`
 *  interrupts no paragraph. */
const boxes = definePlugin({
	name: 'boxes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container({
				name: 'box',
				label: 'Box',
				lines: BOX,
				interrupts: true,
				sample: '%> x',
				insert: { none: 'a test block type' }
			}),
			container({
				name: 'headed',
				label: 'Headed',
				interrupts: true,
				lines: {
					...BOX,
					first: '%! ',
					rest: '%! ',
					reads: /^%! ?/,
					head: {
						match: /^\[!(\w+)\]$/,
						data: (match: RegExpExecArray) => ({ type: match[1] }),
						write: (data: { type: string }) => `[!${data.type}]`
					}
				},
				sample: '%! [!NOTE]\n%! x',
				insert: { none: 'a test block type' }
			}),
			container({
				name: 'quiet',
				label: 'Quiet',
				lines: { ...BOX, first: '&> ', rest: '&> ', reads: /^ {0,3}&>[ \t]?/ },
				sample: '&> x',
				insert: { none: 'a test block type' }
			}),
			container({
				name: 'note',
				label: 'Note',
				joins: false,
				lines: {
					shape: 'indented',
					open: /^@(\w+): ?/,
					data: (match: RegExpExecArray) => ({ label: match[1] }),
					first: (data: { label: string }) => `@${data.label}: `,
					rest: () => '    ',
					lazy: true
				},
				sample: '@a: x',
				insert: { none: 'a test block type' }
			})
		]
	})
});

const PLUGINS = [...SYNTAX_PLUGINS, mermaidPlugin(), boxes];

async function mounted(source: string): Promise<Editor> {
	const editor = mountEditor<EditorTestSurface>({ source, plugins: PLUGINS });
	await editor.settle();
	return editor;
}

const withoutSpans = (node: CstNode): CstNode =>
	({ ...node, childSpans: undefined, children: node.children?.map(withoutSpans) }) as CstNode;

/** Each text position of `doc` whose byte holds another character, or reads back as another. */
function misplaced(doc: Document): string[] {
	const source = serialize(doc);
	const map = documentByteMap(measured(doc));
	const out: string[] = [];
	for (const path of allBlockPaths(doc)) {
		const node = blockNodeAt(doc, path)!;
		if (node.children) continue;
		for (let offset = 0; offset <= displayLength(node.raw); offset++) {
			// No text position sits between a line's `\r` and its `\n`.
			if (node.raw[offset - 1] === '\r' && node.raw[offset] === '\n') continue;
			const byte = map.byteOf(path, offset);
			const held = byte === null ? undefined : source[byte];
			const back = byte === null ? null : map.leafAt(byte);
			const here = offset < displayLength(node.raw) ? node.raw[offset] : held;
			if (held !== here || JSON.stringify(back) !== JSON.stringify({ path, offset })) {
				out.push(`[${path}]@${offset}: byte ${byte} holds ${JSON.stringify(held)}`);
			}
		}
	}
	return out;
}

describe('the byte map finds the text of a container under its own marker', () => {
	it.each([
		[
			'a quote, as the built-in reads it',
			'> one\r\n> more\r\n>\r\n> two\r\nlazy\r\n',
			'blockquote'
		],
		['marked', 'para\n\n%> one\n%> more\n%>\n%> two\nlazy\n\ntail\n', 'boxes/box'],
		['marked, CRLF', 'para\r\n\r\n%> one\r\n%>\r\n%> two\r\n\r\ntail\r\n', 'boxes/box'],
		['a quote in it', '%> one\n%>\n%> > two\n%> > three\n', 'boxes/box'],
		['in a quote', '> %> one\n> %>\n> %> two\n', 'blockquote'],
		['under a head line', '%! [!NOTE]\n%!\n%! one\n%!\n%! two\n\ntail\n', 'boxes/headed'],
		['indented', 'para\n\n@a: one\nlazy\n\n    two\n\n    - item\n\ntail\n', 'boxes/note']
	])('%s', async (_name, source, kind) => {
		const doc = (await mounted(source)).instance.__test.getDocument() as unknown as Document;
		expect(doc.children.map((block) => block.kind)).toContain(kind);
		expect(misplaced(doc)).toEqual([]);
		expect(misplaced({ ...doc, children: doc.children.map(withoutSpans) })).toEqual([]);
	});
});

const at = (path: number[], offset: number) => ({ path, offset });

/** `text` with each line's opening run of quote markers written as the box's, or only the markers
 *  at `depths` of each run, outermost 0. */
const boxing =
	(depths?: readonly number[]) =>
	(text: string): string =>
		text.replace(/^(?: {0,3}>[ \t]?)+/gm, (run) => {
			let depth = 0;
			return run.replace(/>/g, () => (!depths || depths.includes(depth++) ? '%>' : '>'));
		});
const boxed = boxing();
const headed = (text: string) => text.replace(/^>/gm, '%!');
const noted = (text: string) => text.replace(/\[\^a\]:/g, '@a:');

const ALERT = 'para\n\n> [!NOTE]\n> one\n>\n> two\n\ntail\n';
const FOOTNOTE = 'para\n\n[^a]: one\n    more\n\n    two\n\ntail\n';

type Point = [path: number[], offset: number];

/** Ranges over a quote's lines, each run again with `%>` for the quote's `>`; over an alert's and a
 *  footnote's, with the marker `twin` writes for theirs. */
const RANGES: Record<
	string,
	[source: string, from: Point, to: Point, twin?: (text: string) => string]
> = {
	'all its text, mid-document': ['para\n\n> one\n>\n> two\n\ntail\n', [[1, 0], 0], [[1, 1], 3]],
	'all its text, ending the document': ['para\n\n> one\n>\n> two', [[1, 0], 0], [[1, 1], 3]],
	'all its text, alone': ['> one\n>\n> two\n', [[0, 0], 0], [[0, 1], 3]],
	'part of two children': ['para\n\n> one\n> more\n>\n> two\n> end\n', [[1, 0], 5], [[1, 1], 2]],
	'its first child whole': ['para\n\n> one\n>\n> two\n\ntail\n', [[1, 0], 0], [[1, 1], 0]],
	'from the paragraph above': ['para\n\n> one\n>\n> two\n\ntail\n', [[0], 2], [[1, 0], 1]],
	'into the paragraph below': ['para\n\n> one\n>\n> two\n\ntail\n', [[1, 1], 1], [[2], 2]],
	'into a list it holds': [
		'> one\n>\n> - two\n> - three\n\ntail\n',
		[[0, 0], 1],
		[[0, 1, 1, 0], 2]
	],
	CRLF: ['para\r\n\r\n> one\r\n>\r\n> two\r\n\r\ntail\r\n', [[1, 0], 1], [[1, 1], 2]],
	'under a head line, all its text': [ALERT, [[1, 0], 0], [[1, 1], 3], headed],
	'under a head line, into the paragraph below': [ALERT, [[1, 1], 1], [[2], 2], headed],
	'indented, part of two children': [FOOTNOTE, [[1, 0], 5], [[1, 1], 2], noted],
	'indented, from the paragraph above': [FOOTNOTE, [[0], 2], [[1, 0], 1], noted]
};

/** What `route` leaves of `source` and writes to the clipboard, over the range `from`..`to`. */
async function removed(
	source: string,
	from: Point,
	to: Point,
	route: 'Backspace' | 'Delete' | 'cut'
): Promise<{ source: string; copy: string }> {
	await destroyMountedEditors();
	const editor = await mounted(source);
	expect(await placeRange(editor, { anchor: at(...from), focus: at(...to) })).toBe(true);
	if (route === 'cut') {
		const copy = (await clipboardGesture(editor, 'cut', 'key'))['text/plain'] ?? '';
		return { source: editor.source(), copy };
	}
	await pressHardwareKey(document.activeElement as HTMLElement, { key: route });
	await editor.settle();
	return { source: editor.source(), copy: '' };
}

describe('a range in a container under its own marker goes as under a built-in’s', () => {
	for (const route of ['Backspace', 'Delete', 'cut'] as const) {
		it.each(Object.entries(RANGES))(`${route}: %s`, async (_name, row) => {
			const [source, from, to, twin = boxed] = row;
			const known = await removed(source, from, to, route);
			expect(known.source, 'the range went').not.toBe(source);
			const own = await removed(twin(source), from, to, route);
			expect(own).toEqual({ source: twin(known.source), copy: twin(known.copy) });
		});
	}
});

/** Where byte `at` of `source` sits once `twin` boxed its quote markers. */
const twinAt = (twin: (text: string) => string, source: string, at: number) =>
	twin(source.slice(0, at) + '\u0001' + source.slice(at)).indexOf('\u0001');

/** What the range-edit core answers over the marked range of `marked` with its quote markers boxed
 *  by `twin`, and that answer as the quote's, boxed the same way. */
async function twinAnswers(
	marked: string,
	gesture: Gesture,
	mode: 'source' | 'live',
	twin = boxed
) {
	const grammar = (await mounted('x\n')).instance.__test.getGrammar();
	const host = noTransforms(rangeHost(fixtureReading({ grammar }, mode)));
	const source = unmark(marked);
	const range = rangeOf(marked);
	const quote = editRange(source, range, gesture, mode, host);
	const moved = (text: string, at: number) => twinAt(twin, text, at);
	const twinned =
		typeof gesture !== 'string' && 'paste' in gesture
			? { ...gesture, paste: twin(gesture.paste) }
			: gesture;
	const box = editRange(
		twin(source),
		{ from: moved(source, range.from), to: moved(source, range.to) },
		twinned,
		mode,
		host
	);
	return {
		got: { source: box.source, clipboard: box.clipboard, caret: box.caret },
		want: {
			source: twin(quote.source),
			clipboard: quote.clipboard === undefined ? undefined : twin(quote.clipboard),
			caret: { ...quote.caret, at: moved(quote.source, quote.caret.at) }
		}
	};
}

/** The row whose quote leaves its caret where the removal began, inside the marker of the line a
 *  parting line pushed down; the box's sits inside its own wider marker, so only the line maps. */
const CARET_INSIDE_A_MARKER =
	'L4 a line the text above still opens keeps its quote’s marker on the blank line before it';

const caretLine = (answer: { source: string; caret: { at: number; holds: string } }) => ({
	...answer,
	caret: {
		line: answer.source.slice(0, answer.caret.at).split('\n').length,
		...answer.caret,
		at: 0
	}
});

/** Shapes whose answer reads a line's markers: the blank line keeping two blocks apart, a paste into
 *  an empty block beside a blank line, and a box and a quote held one in the other. */
const TWIN_ROWS: [name: string, marked: string, gesture: Gesture, depths?: number[]][] = [
	['a rule taken from between a paragraph and code', '> a\n> ⟦***⟧\n>     code\n', 'backspace'],
	['a rule taken from above a table', '> a\n> ⟦***⟧\n> | h |\n> | - |\n', 'backspace'],
	['a rule taken from under a blank line above code', '> a\n>\n> ⟦***⟧\n>     code\n', 'backspace'],
	[
		'a paste into an emptied heading under a blank line',
		'> a\n>\n> #⟦⟧\n>\n> b\n',
		{ paste: '# h\n', plain: false, holds: 'text' }
	],
	[
		'a paste into an empty list item above an empty first line',
		'- ⟦⟧\n>\n> x\n',
		{ paste: '# h\n', plain: false, holds: 'text' }
	],
	[
		'a paste into an empty paragraph above code',
		'> para\n>\n> ⟦⟧\n>     code\n',
		{ paste: 'p', plain: false, holds: 'text' }
	],
	['a box in a quote', '> > ⟦a⟧\n> >\n> > b\n>\n> c\n', 'backspace', [1]],
	['a quote in a box', '> > ⟦a⟧\n> >\n> > b\n>\n> c\n', 'backspace', [0]]
];

describe('the range-edit core answers a named quote row alike under the box’s marker', () => {
	const rows = NAMED_ROWS.filter(
		(row) =>
			(typeof row.gesture === 'string' || 'paste' in row.gesture) &&
			/^ {0,3}>/m.test(unmark(row.source)) &&
			// An alert's head line is the quote's own; under `%>` it is text.
			!row.source.includes('[!')
	);
	for (const mode of ['source', 'live'] as const) {
		it.each(rows)(`${mode}: $name`, async (row) => {
			const { got, want } = await twinAnswers(row.source, row.gesture, row.mode ?? mode);
			if (row.name === CARET_INSIDE_A_MARKER) expect(caretLine(got)).toEqual(caretLine(want));
			else expect(got).toEqual(want);
		});
	}

	it.each(TWIN_ROWS)('%s', async (_name, marked, gesture, depths) => {
		const { got, want } = await twinAnswers(marked, gesture, 'source', boxing(depths));
		expect(got).toEqual(want);
	});

	// Miss-analysis: every twin row mounted its editor with the box on, so none read a marker the
	// editor's list turned on after a range edit had read the markers once.
	it('after `use` turns the box on in an editor that has made a range edit', async () => {
		const editor = mountEditor<EditorTestSurface>({
			source: 'x\n',
			plugins: PLUGINS.filter((plugin) => plugin !== boxes)
		});
		await editor.settle();
		const host = noTransforms(
			rangeHost(fixtureReading({ grammar: editor.instance.__test.getGrammar() }))
		);
		const marked = '%> a\n%> ⟦***⟧\n%>     code\n';
		const answer = () => editRange(unmark(marked), rangeOf(marked), 'backspace', 'source', host);
		answer();
		editor.instance.use(PLUGINS);
		await editor.settle();
		expect(answer().source).toBe('%> a\n%>\n%>     code\n');
	});
});

const outline = (nodes: readonly CstNode[]): string =>
	nodes.map((n) => (n.children?.length ? `${n.kind}(${outline(n.children)})` : n.kind)).join(' ');

/** `lines` as a document, at top level or inside a container, an empty line its own way. */
const DEPTHS: Record<string, (lines: string[]) => string> = {
	'top level': (lines) => lines.join('\n'),
	quote: (lines) => lines.map((l) => (l ? `> ${l}` : '>')).join('\n'),
	'list item': (lines) => lines.map((l, i) => (i === 0 ? `- ${l}` : l && `  ${l}`)).join('\n'),
	box: (lines) => lines.map((l) => (l ? `%> ${l}` : '%>')).join('\n')
};

/** A box that interrupts no paragraph under a block an edit leaves above it, with and without an
 *  empty first line: a rule taken from between them, or a paste into an empty paragraph. */
const QUIET_BELOW = Object.entries(DEPTHS).flatMap(([depth, write]) =>
	[['&> x'], ['&>', '&> x']].flatMap((box) => {
		const taken = write(['para', '⟦***⟧', ...box]) + '\n';
		const empty = write(['para', '', '⟦⟧', ...box]) + '\n';
		const rows: [Gesture, string][] = [
			['backspace', taken],
			['cut', taken],
			[{ paste: 'p\n', plain: false, holds: 'text' }, taken],
			[{ paste: 'p', plain: false, holds: 'text' }, empty]
		];
		return rows.map(([gesture, marked]) => ({
			name: `${depth}, ${JSON.stringify(gesture)}: ${JSON.stringify(marked)}`,
			gesture,
			marked
		}));
	})
);

describe('a box that interrupts no paragraph stays a box under the block an edit leaves above it', () => {
	it.each(QUIET_BELOW)('$name', async ({ gesture, marked }) => {
		const grammar = (await mounted('x\n')).instance.__test.getGrammar();
		const host = noTransforms(rangeHost(fixtureReading({ grammar })));
		const source = unmark(marked);
		const out = editRange(source, rangeOf(marked), gesture, 'source', host).source;
		const kinds = (text: string) => outline(parse(text, { grammar }).children as CstNode[]);
		expect(kinds(out), out).toBe(kinds(source).replace(' thematicBreak', ''));
	});
});
