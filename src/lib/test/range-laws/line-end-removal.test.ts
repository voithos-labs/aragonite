// @vitest-environment jsdom
// A range from a block taken whole to a line's end, its block running on below, mounted in both
// modes: each removal leaves the next line behind its own markers once, and a letter typed after it
// lands at that line's text. Rows whose Backspace or cut lands on a container's opening line type
// their letter after Delete and over the range alone.
// Miss-analysis: every mounted row ended mid-line, so none ended at a line's end, where the removal
// wrote that line's markers in front of the next line's.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import {
	clipboardGesture,
	deleteGesture,
	mountCase,
	placeRange,
	typeGesture,
	type Editor
} from './gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

const MODES: PresentationMode[] = ['source', 'live'];
type Gesture = 'Backspace' | 'Delete' | 'cut' | 'a typed key';

interface Row {
	name: string;
	source: string;
	select: EditorSelection;
	/** What Backspace, Delete and a cut leave. */
	removed: string;
	/** The document once each gesture and a letter are in. */
	typed: Partial<Record<Gesture, string>>;
}

const toEnd = (path: number[], offset: number) => ({
	anchor: { path: [0], offset: 0 },
	focus: { path, offset }
});

const ROWS: Row[] = [
	{
		name: 'a code line in a quote',
		source: '***\n\nbody\n\n> ```\n> code\n> more\n> ```\n',
		select: toEnd([2, 0], 8),
		removed: '> ```\n> more\n> ```\n',
		typed: {
			Backspace: '> ```\n> xmore\n> ```\n',
			Delete: '> ```\n> xmore\n> ```\n',
			cut: '> ```\n> xmore\n> ```\n',
			'a typed key': 'x\n\n> ```\n> more\n> ```\n'
		}
	},
	{
		name: 'a code line in an item',
		source: '***\n\nbody\n\n- ```\n  code\n  more\n  ```\n',
		select: toEnd([2, 0, 0], 8),
		removed: '- ```\n  more\n  ```\n',
		typed: {
			Backspace: '- ```\n  xmore\n  ```\n',
			Delete: '- ```\n  xmore\n  ```\n',
			cut: '- ```\n  xmore\n  ```\n',
			'a typed key': 'x\n\n- ```\n  more\n  ```\n'
		}
	},
	{
		name: 'a code line two quotes deep, in CRLF',
		source: '***\r\n\r\nbody\r\n\r\n> > ```\r\n> > code\r\n> > more\r\n> > ```\r\n',
		select: toEnd([2, 0, 0], 9),
		removed: '> > ```\r\n> > more\r\n> > ```\r\n',
		typed: {
			Backspace: '> > ```\r\n> > xmore\r\n> > ```\r\n',
			Delete: '> > ```\r\n> > xmore\r\n> > ```\r\n',
			cut: '> > ```\r\n> > xmore\r\n> > ```\r\n',
			'a typed key': 'x\r\n\r\n> > ```\r\n> > more\r\n> > ```\r\n'
		}
	},
	{
		name: 'a quote line in a note',
		source: '***\n\nbody\n\n:::note\n> inner\n> more\n:::\n',
		select: toEnd([2, 1, 0], 5),
		removed: ':::note\n> more\n:::\n',
		typed: {
			Delete: ':::note\n> xmore\n:::\n',
			'a typed key': 'x\n\n:::note\n> more\n:::\n'
		}
	},
	{
		name: 'a line in a tip in a footnote',
		source: '***\n\nbody\n\n[^1]: :::tip\n    inner\n    more\n    :::\n',
		select: toEnd([2, 0, 1], 5),
		removed: '[^1]: :::tip\n    more\n    :::\n',
		typed: {
			Delete: '[^1]: :::tip\n    xmore\n    :::\n',
			'a typed key': 'x\n\n[^1]: :::tip\n    more\n    :::\n'
		}
	},
	{
		name: 'a code line over a blank one, in a tip',
		source: '***\n\nbody\n\n:::tip\n```\ncode\n\nmore\n```\n:::\n',
		select: toEnd([2, 1], 8),
		removed: ':::tip\n```\n\nmore\n```\n:::\n',
		typed: {
			Delete: ':::tip\n```\nx\nmore\n```\n:::\n',
			'a typed key': 'x\n\n:::tip\n```\n\nmore\n```\n:::\n'
		}
	}
];

async function run(editor: Editor, gesture: Gesture): Promise<void> {
	if (gesture === 'cut') await clipboardGesture(editor, 'cut', 'key');
	else if (gesture === 'a typed key')
		await typeGesture(editor, { text: 'x', route: 'hardware key' });
	else await deleteGesture(editor, gesture);
}

const focused = () => (document.activeElement as HTMLElement | null) ?? document.body;

describe('a range ending at a line’s end, its block running on', () => {
	for (const mode of MODES)
		for (const row of ROWS)
			for (const gesture of ['Backspace', 'Delete', 'cut', 'a typed key'] as const) {
				it(`${mode}: ${row.name}, ${gesture}`, async () => {
					const editor = mountCase(row.source, mode);
					await editor.settle();
					await placeRange(editor, row.select);
					await run(editor, gesture);
					if (gesture !== 'a typed key') expect(editor.source()).toBe(row.removed);
					const typed = row.typed[gesture];
					if (typed === undefined) return;
					if (gesture !== 'a typed key') {
						await pressHardwareKey(focused(), { key: 'x' });
						await editor.settle();
					}
					expect(editor.source()).toBe(typed);
				});
			}
});
