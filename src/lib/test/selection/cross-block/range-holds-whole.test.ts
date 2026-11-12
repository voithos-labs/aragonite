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
	TYPING_ROUTES,
	type TypingRoute
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
const OPEN = '<details open>\n<summary>Sum</summary>\n\n';
const at = (path: number[], offset: number) => ({ path, offset });

interface Shape {
	source: string;
	range: EditorSelection;
	/** The blocks a removal leaves. */
	left: unknown[];
	/** What a copy, and a cut, writes. */
	clip: string;
	/** What no route leaves behind. */
	gone: RegExp;
	/** The typing routes that write over the range; all three where unset. */
	typing?: readonly TypingRoute[];
}

const SHAPES: Record<string, Shape> = {
	'out of a closed summary': {
		source: `${CLOSED}\n\npara\n`,
		range: { anchor: at([0, 0], 1), focus: at([1], 0) },
		left: [['paragraph', 'para']],
		clip: CLOSED,
		gone: /summary|details|body/
	},
	'out of a closed summary in a quote': {
		source: '> <details>\n> <summary>Sum</summary>\n>\n> body\n>\n> </details>\n>\n> para\n',
		range: { anchor: at([0, 0, 0], 3), focus: at([0, 1], 0) },
		left: [['blockquote', [['paragraph', 'para']]]],
		clip: CLOSED,
		gone: /summary|details|body/
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
		],
		clip: CLOSED,
		gone: /summary|details|body/
	},
	'from a paragraph across an open details to a heading': {
		source: `abc\n\n${OPEN}body\n\n</details>\n\n# h\n`,
		range: { anchor: at([0], 1), focus: at([2], 0) },
		left: [
			['paragraph', 'a'],
			['heading', '# h']
		],
		clip: `bc\n\n${OPEN}body\n\n</details>`,
		gone: /summary|details|body/
	},
	// The summary alone is held whole: its text goes, its tags and the container stay.
	'from a paragraph to an open details’ first block': {
		source: `abc\n\n${OPEN}---\n\nbody\n\n</details>\n`,
		range: { anchor: at([0], 1), focus: at([1, 1], 0) },
		left: [
			['paragraph', 'a'],
			[
				'details',
				[
					['details-summary', ''],
					['thematicBreak', '---'],
					['paragraph', 'body']
				]
			]
		],
		clip: 'bc\n\n<details open>\n<summary>Sum</summary>\n</details>',
		gone: /Sum/,
		// A soft key or an IME over this range writes nothing, here as before the fix.
		typing: ['hardware key']
	}
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
		for (const [shape, { source, range, left, clip, gone, typing }] of Object.entries(SHAPES)) {
			it.each(['Backspace', 'Delete'])(`${mode}, ${shape}: %s`, async (key) => {
				const editor = await placed(source, range, mode);
				await pressHardwareKey(focused(), { key });
				await editor.settle();
				expect(blocksIn(editor)).toEqual(left);
			});

			it(`${mode}, ${shape}: a cut, and its clipboard`, async () => {
				const editor = await placed(source, range, mode);
				const cut = (await clipboardGesture(editor, 'cut', 'key'))['text/plain'];
				expect(cut, 'the clipboard').toBe(clip);
				expect(blocksIn(editor)).toEqual(left);
			});

			it(`${mode}, ${shape}: a copy`, async () => {
				const editor = await placed(source, range, mode);
				const copy = (await clipboardGesture(editor, 'copy', 'key'))['text/plain'];
				expect(copy).toBe(clip);
				expect(editor.source()).toBe(source);
			});

			it.each(typing ?? TYPING_ROUTES)(`${mode}, ${shape}: a letter by %s`, async (route) => {
				const editor = await placed(source, range, mode);
				await insertBy(route, focused(), 'x');
				await editor.settle();
				expect(editor.source()).not.toMatch(gone);
				expect(editor.source()).toContain('x');
			});

			it(`${mode}, ${shape}: Enter, and a paste`, async () => {
				let editor = await placed(source, range, mode);
				await pressHardwareKey(focused(), { key: 'Enter' });
				await editor.settle();
				expect(editor.source(), 'Enter').not.toMatch(gone);
				await destroyMountedEditors();
				editor = await placed(source, range, mode);
				await pasteGesture(editor, { 'text/plain': 'q' }, 'key');
				expect(editor.source(), 'a paste').not.toMatch(gone);
				expect(editor.source()).toContain('q');
			});
		}
	}
});
