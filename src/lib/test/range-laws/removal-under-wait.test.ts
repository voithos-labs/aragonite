// @vitest-environment jsdom
// A removal that leaves two blocks touching which a definition above, its title started, would read
// into itself keeps them apart with a blank line, by every gesture over the range; a key over the
// range leaves what the removal and then the same key leave, the key where the range began.
// Miss-analysis: the removal asked the pair it left alone, and no row put a block above the pair
// that still waited on the lines under it.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
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
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	blocksIn,
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	type Editor
} from './gestures';

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

const MODES: PresentationMode[] = ['source', 'live'];

interface Row {
	source: string;
	/** The line between the pair, with its line ending. */
	take: EditorSelection;
	/** The bytes every removal leaves. */
	removed: string;
}

const line = (path: number[], next: number[]): EditorSelection => ({
	anchor: { path, offset: 0 },
	focus: { path: next, offset: 0 }
});

const ROWS: Record<string, Row> = {
	'a heading between code and the line that closes the title': {
		source: "[a]: /u\n    'code\n# h\ntext\nend'\n\nlast\n",
		take: line([2], [3]),
		removed: "[a]: /u\n    'code\n\ntext\nend'\n\nlast\n"
	},
	'the same inside a quote': {
		source: "> [a]: /u\n>     'code\n> # h\n> text\n> end'\n\nlast\n",
		take: line([0, 2], [0, 3]),
		removed: "> [a]: /u\n>     'code\n>\n> text\n> end'\n\nlast\n"
	},
	'a heading between two paragraphs under a title on its own line': {
		source: "[a]: /u\n'title\n# h\ntext\nend'\n\nlast\n",
		take: line([2], [3]),
		removed: "[a]: /u\n'title\n\ntext\nend'\n\nlast\n"
	},
	'a heading under a second definition, the first one waiting': {
		source: "[a]: /u\n    'code\n[b]: /v\n# h\nend'\n\nlast\n",
		take: line([3], [4]),
		removed: "[a]: /u\n    'code\n[b]: /v\n\nend'\n\nlast\n"
	}
};

/** A title the definition starts itself folds the line under the range in, as the pair reads. */
const FOLDS: Record<string, Row> = {
	'a heading between a definition and its title': {
		source: '[a]: /u\n# h\n"t"\n\nlast\n',
		take: line([1], [2]),
		removed: '[a]: /u\n"t"\n\nlast\n'
	}
};

async function key(editor: Editor, name: string): Promise<void> {
	const el = (document.activeElement as HTMLElement | null) ?? document.body;
	await pressHardwareKey(el, { key: name });
	await editor.settle();
}

type Removal = 'Backspace' | 'Delete' | 'Mod+X';
type Key = 'q' | 'Enter' | 'paste';

async function press(editor: Editor, gesture: Removal | Key): Promise<void> {
	if (gesture === 'Mod+X') await clipboardGesture(editor, 'cut', 'key');
	else if (gesture === 'paste') await pasteGesture(editor, { 'text/plain': 'q' }, 'key');
	else await key(editor, gesture);
}

async function over(row: Row, mode: PresentationMode, gesture: Removal | Key): Promise<Editor> {
	const editor = mountCase(row.source, mode);
	await editor.settle();
	expect(await placeOwnedRange(editor, row.take), 'the range would not place').toBe(true);
	await press(editor, gesture);
	return editor;
}

/** The tree a reload of the editor's bytes reads, blank lines aside. */
async function reloaded(editor: Editor, mode: PresentationMode): Promise<unknown[]> {
	const source = editor.source();
	const fresh = mountCase(source, mode);
	await fresh.settle();
	return blocksIn(fresh);
}

const reads = (editor: Editor) => ({
	source: editor.source(),
	caret: editor.instance.getSelection(),
	gap: editor.instance.__test.getGapCaret()
});

describe('a removal under a started title keeps the pair it uncovers apart', () => {
	const cases = MODES.flatMap((mode) =>
		Object.entries(ROWS).flatMap(([name, row]) =>
			(['Backspace', 'Delete', 'Mod+X'] as const).map((gesture) => ({ mode, name, row, gesture }))
		)
	);
	it.each(cases)('$mode, $name: $gesture', async ({ mode, row, gesture }) => {
		const editor = await over(row, mode, gesture);
		expect(editor.source()).toBe(row.removed);
		// The lower block stands where the range began, and the caret at its text.
		const start = row.take.anchor;
		expect(reads(editor)).toMatchObject({ caret: { anchor: start, focus: start }, gap: null });
		expect(blocksIn(editor)).toEqual(await reloaded(editor, mode));
	});
});

describe('a key over the range is the removal, then the key', () => {
	const cases = MODES.flatMap((mode) =>
		Object.entries({ ...ROWS, ...FOLDS }).flatMap(([name, row]) =>
			(['q', 'Enter', 'paste'] as const).map((gesture) => ({ mode, name, row, gesture }))
		)
	);
	it.each(cases)('$mode, $name: $gesture', async ({ mode, row, gesture }) => {
		const stepwise = mountCase(row.source, mode);
		await stepwise.settle();
		expect(await placeOwnedRange(stepwise, row.take)).toBe(true);
		await press(stepwise, 'Backspace');
		await press(stepwise, gesture);
		const want = reads(stepwise);
		await destroyMountedEditors();

		const editor = await over(row, mode, gesture);
		expect(reads(editor)).toEqual(want);
		expect(blocksIn(editor)).toEqual(await reloaded(editor, mode));
		// The text lands on the line the range began on, under the lines above it as they were.
		const above = row.source.slice(0, row.source.lastIndexOf('\n', row.source.indexOf('# h')) + 1);
		expect(editor.source().startsWith(above), 'the lines above the range stay').toBe(true);
		if (gesture !== 'Enter') {
			const lower = editor.source().indexOf(row.removed.slice(above.length).replace(/^[\s>]+/, ''));
			expect(editor.source().indexOf('q'), 'the text lands where the range began').toBe(lower - 1);
		}
	});
});
