// @vitest-environment jsdom
// A plugin's container under a marker of its own, found in the document's bytes: every text
// position has its byte, and a range in it is cut and removed as the same range in a quote is.
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
import { allBlockPaths } from '../../invariants/arbitraries/index';
import { clipboardGesture, placeRange, type Editor } from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

const BOX = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

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

async function mounted(source: string): Promise<Editor> {
	const editor = mountEditor<EditorTestSurface>({ source, plugins: [boxes] });
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

/** Ranges over a quote's lines; each runs again with `%>` for the quote's `>`. */
const RANGES: Record<string, [source: string, from: [number[], number], to: [number[], number]]> = {
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
	CRLF: ['para\r\n\r\n> one\r\n>\r\n> two\r\n\r\ntail\r\n', [[1, 0], 1], [[1, 1], 2]]
};

const boxed = (text: string) => text.replace(/^>/gm, '%>');

/** What `route` leaves of `source` and writes to the clipboard, over the range `from`..`to`. */
async function removed(
	source: string,
	from: [number[], number],
	to: [number[], number],
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

describe('a range in a container under its own marker goes as it does in a quote', () => {
	for (const route of ['Backspace', 'Delete', 'cut'] as const) {
		it.each(Object.entries(RANGES))(`${route}: %s`, async (_name, [source, from, to]) => {
			const quote = await removed(source, from, to, route);
			expect(quote.source, 'the quote’s range went').not.toBe(source);
			const box = await removed(boxed(source), from, to, route);
			expect(box).toEqual({ source: boxed(quote.source), copy: boxed(quote.copy) });
		});
	}
});
