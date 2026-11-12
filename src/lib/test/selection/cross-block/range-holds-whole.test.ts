// @vitest-environment jsdom
// Every route over a range that holds a block whole takes that block whole: the bytes left and the
// clipboard are read here as literals, since the copy and the removal share one reader.
// Miss-analysis: the route suites compared each route with the core's answer for the same range,
// so a range read wrong for all of them passed.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	blocksIn,
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeRange,
	type Editor
} from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const CLOSED = '<details>\n<summary>Sum</summary>\n\nbody\n\n</details>';
const at = (path: number[], offset: number) => ({ path, offset });

/** Each shape: its source, the range, and the blocks a removal leaves. */
const SHAPES: Record<string, { source: string; range: EditorSelection; left: unknown[] }> = {
	'out of a closed summary': {
		source: `${CLOSED}\n\npara\n`,
		range: { anchor: at([0, 0], 1), focus: at([1], 0) },
		left: [['paragraph', 'para']]
	},
	'out of a closed summary in a quote': {
		source: '> <details>\n> <summary>Sum</summary>\n>\n> body\n>\n> </details>\n>\n> para\n',
		range: { anchor: at([0, 0, 0], 3), focus: at([0, 1], 0) },
		left: [['blockquote', [['paragraph', 'para']]]]
	},
	'out of a closed summary in a `:::note`': {
		source: `:::note\n${CLOSED}\n\npara\n:::\n`,
		range: { anchor: at([0, 1, 0], 1), focus: at([0, 2], 0) },
		left: [
			[
				'admonition',
				[
					['directiveOpenerLine', ':::note'],
					['paragraph', 'para']
				]
			]
		]
	},
	'from a paragraph across an open details to a heading': {
		source: 'abc\n\n<details open>\n<summary>Sum</summary>\n\nbody\n\n</details>\n\n# h\n',
		range: { anchor: at([0], 1), focus: at([2], 0) },
		left: [
			['paragraph', 'a'],
			['heading', '# h']
		]
	}
};

const removed = (e: Editor) => {
	const source = e.source();
	return { blocks: blocksIn(e), shards: /summary|details|body/.test(source) };
};

async function placed(source: string, range: EditorSelection, mode: 'live' | 'source') {
	const editor = mountCase(source, mode);
	await editor.settle();
	expect(await placeRange(editor, range), 'the range would not place').toBe(true);
	return editor;
}

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

describe('a range holding a block whole takes it whole on every route', () => {
	for (const mode of ['live', 'source'] as const) {
		for (const [shape, { source, range, left }] of Object.entries(SHAPES)) {
			it.each(['Backspace', 'Delete'])(`${mode}, ${shape}: %s`, async (key) => {
				const editor = await placed(source, range, mode);
				await pressHardwareKey(focused(), { key });
				await editor.settle();
				expect(removed(editor)).toEqual({ blocks: left, shards: false });
			});

			it(`${mode}, ${shape}: a cut, and its clipboard`, async () => {
				const editor = await placed(source, range, mode);
				const cut = (await clipboardGesture(editor, 'cut', 'key'))['text/plain'];
				expect(removed(editor)).toEqual({ blocks: left, shards: false });
				expect(cut).toContain(source.includes(CLOSED) ? CLOSED : '</details>');
			});

			it(`${mode}, ${shape}: a copy writes the block whole`, async () => {
				const editor = await placed(source, range, mode);
				const copy = (await clipboardGesture(editor, 'copy', 'key'))['text/plain'];
				expect(copy).toContain(source.includes(CLOSED) ? CLOSED : '\n\n</details>');
				expect(editor.source()).toBe(source);
			});

			it.each(['hardware key', 'soft key', 'composition'] as const)(
				`${mode}, ${shape}: a letter by %s`,
				async (route) => {
					const editor = await placed(source, range, mode);
					await insertBy(route, focused(), 'x');
					await editor.settle();
					expect(removed(editor).shards).toBe(false);
					expect(editor.source()).toContain('x');
				}
			);

			it(`${mode}, ${shape}: Enter, and a paste`, async () => {
				let editor = await placed(source, range, mode);
				await pressHardwareKey(focused(), { key: 'Enter' });
				await editor.settle();
				expect(removed(editor).shards, 'Enter').toBe(false);
				await destroyMountedEditors();
				editor = await placed(source, range, mode);
				await pasteGesture(editor, { 'text/plain': 'q' }, 'key');
				expect(removed(editor).shards, 'a paste').toBe(false);
				expect(editor.source()).toContain('q');
			});
		}
	}
});
