// @vitest-environment jsdom
// Miss-analysis: every strip-rebuild row ended its container with a line break, so no suite held a
// last `>` (or an item's indent) with none, which the body's text can't spell and a rebuild dropped.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Gesture = 'letter' | 'Enter' | 'Backspace';

interface Row {
	source: string;
	/** The paragraph the keys go to, and the caret before the first key. */
	path: number[];
	at: number;
	/** The bytes after the gesture and a letter `y`, by gesture. */
	after: Partial<Record<Gesture, string>>;
}

const ROWS: Record<string, Row> = {
	'a quote': {
		source: '> ab\n>\n> ',
		path: [0, 0],
		at: 1,
		after: { letter: '> axyb\n>\n> ', Enter: '> a\n>\n> yb\n>\n> ', Backspace: '> yb\n>\n> ' }
	},
	'a nested quote': {
		source: '> > ab\n> >\n> > ',
		path: [0, 0, 0],
		at: 1,
		after: {
			letter: '> > axyb\n> >\n> > ',
			Enter: '> > a\n> >\n> > yb\n> >\n> > ',
			Backspace: '> > yb\n> >\n> > '
		}
	},
	'an alert': {
		source: '> [!NOTE]\n> ab\n>\n> ',
		path: [0, 0],
		at: 1,
		after: {
			letter: '> [!NOTE]\n> axyb\n>\n> ',
			Enter: '> [!NOTE]\n> a\n>\n> yb\n>\n> ',
			Backspace: '> [!NOTE]\n> yb\n>\n> '
		}
	},
	'a quote in an item': {
		source: '- > ab\n  >\n  > ',
		path: [0, 0, 0, 0],
		at: 1,
		after: {
			letter: '- > axyb\n  >\n  > ',
			Enter: '- > a\n  >\n  > yb\n  >\n  > ',
			Backspace: '- > yb\n  >\n  > '
		}
	},
	'a list item': {
		source: '- ab\n\n  ',
		path: [0, 0, 0],
		at: 1,
		after: { letter: '- axyb\n\n  ', Enter: '- a\n  \n- yb\n  ', Backspace: '- yb\n\n  ' }
	},
	'a list item with two blank lines': {
		source: '- ab\n\n\n  ',
		path: [0, 0, 0],
		at: 1,
		after: { letter: '- axyb\n\n\n  ', Backspace: '- yb\n\n\n  ' }
	},
	'a CRLF quote': {
		source: '> ab\r\n>\r\n> ',
		path: [0, 0],
		at: 1,
		after: {
			letter: '> axyb\r\n>\r\n> ',
			Enter: '> a\r\n>\r\n> yb\r\n>\r\n> ',
			Backspace: '> yb\r\n>\r\n> '
		}
	}
};

const FIRST_KEY: Record<Gesture, (el: HTMLElement) => Promise<unknown>> = {
	letter: (el) => pressHardwareKey(el, { key: 'x' }),
	Enter: (el) => pressHardwareKey(el, { key: 'Enter' }),
	Backspace: (el) => deleteBy(el, 'Backspace')
};

const focused = (): HTMLElement => document.activeElement as HTMLElement;

describe('a container keeps a blank last line that has no line break', () => {
	for (const mode of ['source', 'live'] as PresentationMode[])
		for (const [name, row] of Object.entries(ROWS))
			for (const [gesture, after] of Object.entries(row.after) as [Gesture, string][])
				it(`${mode}: ${name}, ${gesture} then a letter`, async () => {
					const editor = mountEditor<EditorTestSurface>({
						source: row.source,
						presentationMode: mode,
						plugins: SYNTAX_PLUGINS
					});
					await editor.settle();
					placeCaret(surfaceAt(editor, row.path), row.at);
					await editor.settle();

					await FIRST_KEY[gesture](focused());
					await editor.settle();
					await pressHardwareKey(focused(), { key: 'y' });
					await editor.settle();

					expect(editor.source()).toBe(after);
					const { getDocument, getGrammar } = editor.instance.__test;
					expect(describeConvergence(getDocument(), getGrammar())).toBeNull();
					expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
				});
});
