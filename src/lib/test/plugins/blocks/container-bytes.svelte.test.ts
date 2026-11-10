// @vitest-environment jsdom
// A plugin's container under a marker of its own, found in the document's bytes: every text
// position has its byte, and a range in it is cut and removed as the same range in a quote is,
// through the editor's routes and over the range-edit core's named rows.
// Miss-analysis: every byte map and removal row drew a built-in's or a bundled plugin's marker,
// which the map read by a pattern of its own, so no row held a marker only a line shape states.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { displayLength } from '#lib/core/lines.js';
import { serialize } from '#lib/core/serializer.js';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { container } from '#lib/components/block-makers/container.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
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

/** One container type under each line shape, none of whose markers a built-in writes. */
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
	const map = documentByteMap(doc);
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

/** `text` with each line's opening run of quote markers written as the box's. */
const boxed = (text: string) =>
	text.replace(/^(?: {0,3}>[ \t]?)+/gm, (run) => run.replace(/>/g, '%>'));
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

/** Where byte `at` of `source` sits once its quote markers are the box's. */
const boxedAt = (source: string, at: number) =>
	boxed(source.slice(0, at) + '\u0001' + source.slice(at)).indexOf('\u0001');

/** Rows whose answer still reads a quote's `>` by a pattern in the range core, so the box keeps a
 *  line the quote lets go or splits where it holds. A row that comes to match leaves this list. */
const READS_A_QUOTE_BY_HAND = new Set([
	'L4 a block held whole behind a quote marker goes with its marker line, never nesting',
	'L4 Delete over a block taken whole behind a quote marker lands in the next quoted line',
	'L4 the same inside a quote keeps one quoted empty line',
	'L4 a line the text above still opens keeps its quote’s marker on the blank line before it'
]);

describe('the range-edit core answers a named quote row alike under the box’s marker', () => {
	const rows = NAMED_ROWS.filter(
		(row) =>
			typeof row.gesture === 'string' &&
			/^ {0,3}>/m.test(unmark(row.source)) &&
			// An alert's head line is the quote's own; under `%>` it is text.
			!row.source.includes('[!')
	);
	for (const mode of ['source', 'live'] as const) {
		it.each(rows)(`${mode}: $name`, async (row) => {
			const grammar = (await mounted('x\n')).instance.__test.getGrammar();
			const host = rangeHost(fixtureReading({ grammar }, row.mode ?? mode));
			const source = unmark(row.source);
			const range = rangeOf(row.source);
			const quote = editRange(source, range, row.gesture, row.mode ?? mode, host);
			const twin = { from: boxedAt(source, range.from), to: boxedAt(source, range.to) };
			const box = editRange(boxed(source), twin, row.gesture, row.mode ?? mode, host);
			const want = {
				source: boxed(quote.source),
				clipboard: quote.clipboard === undefined ? undefined : boxed(quote.clipboard),
				caret: { ...quote.caret, at: boxedAt(quote.source, quote.caret.at) }
			};
			const got = { source: box.source, clipboard: box.clipboard, caret: box.caret };
			if (READS_A_QUOTE_BY_HAND.has(row.name)) expect(got).not.toEqual(want);
			else expect(got).toEqual(want);
		});
	}

	// The blank line that keeps two blocks apart is written with the quote's `>` (`apart.ts`), so
	// under `%>` it comes out bare and ends the box. These rows go once that line reads its marker.
	it.each([
		['a rule taken from between a paragraph and code', '> a\n> ⟦***⟧\n>     code\n'],
		['a rule taken from above a table', '> a\n> ⟦***⟧\n> | h |\n> | - |\n']
	])('still splits the box in two: %s', async (_name, marked) => {
		const grammar = (await mounted('x\n')).instance.__test.getGrammar();
		const host = rangeHost(fixtureReading({ grammar }));
		const source = unmark(marked);
		const range = rangeOf(marked);
		const quote = editRange(source, range, 'backspace', 'source', host);
		const twin = { from: boxedAt(source, range.from), to: boxedAt(source, range.to) };
		const box = editRange(boxed(source), twin, 'backspace', 'source', host);
		expect(quote.source).toMatch(/^> a\n>\n> /);
		expect(box.source).toMatch(/^%> a\n\n%> /);
	});
});
