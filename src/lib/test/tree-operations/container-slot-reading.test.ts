// @vitest-environment jsdom
// A container whose new bytes read as other blocks hands those blocks to its list the way a typed
// write does: a letter at the start of a `:::` opener line, a cut of its marker, a lazy line an
// item gives up. Source mode pins the bytes a text editor gives. Live mode pins only that no line
// is doubled or lost: where a letter on the name lands there belongs to another suite.
// Miss-analysis: no row typed in an opener line's `:::name` with a block flush against the
// container, and the flush-join corpus held no directive.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { displayLines, isBlankText } from '#lib/core/lines.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { activateDirectives } from '#lib/components/blocks/directive/activate-directives.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import {
	insertBy,
	pressHardwareKey,
	type InsertionRoute
} from '#lib/test/harness/insertion-routes.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '#lib/test/behavior/corpus.js';
import { clipboardGesture, runHistory } from '#lib/test/range-laws/gestures.js';

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

type Gesture = { type: string; by?: InsertionRoute } | { remove: 'cut' | 'Backspace' | 'Delete' };

interface Row {
	source: string;
	/** The leaf the gesture starts in, and the caret or the range it holds there. */
	path: number[];
	from: number;
	to?: number;
	gesture: Gesture;
	/** What source mode leaves where the plain splice is not the answer. */
	bytes?: string;
	/** Mounted with `:::` turned on and no plugin, so the row is the built-in directive's alone. */
	bare?: true;
}

const TAIL = '\n\n# h\n';
const letter: Gesture = { type: 'x' };
const row = (source: string, path: number[], more: Partial<Row> = {}): Row => ({
	source,
	path,
	from: 0,
	gesture: letter,
	...more
});

const UNDER_PARAGRAPH = `x\n:::tip\nner\n:::${TAIL}`;
const EMPTIED = `x\n\n\nner\n:::${TAIL}`;

const OPENER_ROWS: Record<string, Row> = {
	'an admonition under a paragraph': row(UNDER_PARAGRAPH, [1, 0]),
	'a titled admonition under a paragraph': row(`x\n:::tip Title\nner\n:::${TAIL}`, [1, 0]),
	'a directive under a paragraph': row(`x\n:::foo\nner\n:::${TAIL}`, [1, 0]),
	'a directive holding two blocks, with no plugin': row(
		`x\n:::foo\nner\n\nmore\n:::${TAIL}`,
		[1, 0],
		{ bare: true }
	),
	'a directive holding a heading': row(`x\n:::foo\n# in\n:::${TAIL}`, [1, 0]),
	'an admonition under a heading': row(`# x\n:::tip\nner\n:::${TAIL}`, [1, 0]),
	'an admonition under a blank line': row(`x\n\n:::tip\nner\n:::${TAIL}`, [1, 0]),
	'an admonition over a paragraph': row(`:::tip\nner\n:::\nmore${TAIL}`, [0, 0]),
	'a directive over a paragraph': row(
		`:::foo
ner
:::
more${TAIL}`,
		[0, 0]
	),
	'an admonition over a list from 3': row(`:::tip\nner\n:::\n3. three${TAIL}`, [0, 0]),
	'an admonition in an admonition, under a paragraph': row(
		`::::note\nx\n:::tip\nner\n:::\n::::${TAIL}`,
		[0, 2, 0]
	),
	'an admonition in an admonition, under a blank line': row(
		`::::note\nx\n\n:::tip\nner\n:::\n::::${TAIL}`,
		[0, 2, 0]
	),
	'a directive holding a heading, in an admonition': row(
		`::::note\n\n:::foo\n# in\n:::\n::::${TAIL}`,
		[0, 1, 0]
	),
	'an admonition in a quote': row(`> x\n> :::tip\n> ner\n> :::${TAIL}`, [0, 1, 0]),
	'an admonition in an item': row(`- x\n  :::tip\n  ner\n  :::${TAIL}`, [0, 0, 1, 0]),
	'an admonition in a quote in an item': row(
		`- > x\n  > :::tip\n  > ner\n  > :::${TAIL}`,
		[0, 0, 0, 1, 0]
	),
	'a quote mark that closes a title a definition above started': row(
		`[a]: /u\n:::tip\nner'\n:::${TAIL}`,
		[1, 0],
		{ gesture: { type: "'" } }
	),
	'a letter that renames a nested admonition': row('::::note\n:::tip\n:::\n::::\n', [0, 1, 0], {
		from: 6
	}),
	'CRLF line endings': row('x\r\n:::tip\r\nner\r\n:::\r\n\r\n# h\r\n', [1, 0]),
	'a soft key': row(UNDER_PARAGRAPH, [1, 0], { gesture: { type: 'x', by: 'soft key' } }),
	'a composition': row(UNDER_PARAGRAPH, [1, 0], { gesture: { type: 'x', by: 'composition' } }),
	'a letter inside the marker': row(UNDER_PARAGRAPH, [1, 0], { from: 1 }),
	'a letter over the marker': row(UNDER_PARAGRAPH, [1, 0], { to: 3 }),
	'a cut of the marker': row(UNDER_PARAGRAPH, [1, 0], { to: 3, gesture: { remove: 'cut' } }),
	'Backspace inside the marker': row(UNDER_PARAGRAPH, [1, 0], {
		from: 1,
		gesture: { remove: 'Backspace' }
	}),
	'Delete at the marker’s start': row(UNDER_PARAGRAPH, [1, 0], {
		gesture: { remove: 'Delete' }
	})
};

const LAZY_LINE_ROWS: Record<string, Row> = {
	'a quote mark typed before an item’s text': row('- item\ntext\n3. three\n', [0, 0, 0], {
		gesture: { type: '>' }
	}),
	'the same over an indented line': row('- item\ntext\n    code\n3. three\nend\n', [0, 0, 0], {
		gesture: { type: '>' }
	}),
	'the same in a quote': row(`> - item\n> text\n> 3. three${TAIL}`, [0, 0, 0, 0], {
		gesture: { type: '>' }
	})
};

// An emptied row is held as every emptied block is: an empty paragraph, with the blank line a
// reload needs to read one.
const EMPTIED_ROWS: Record<string, Row> = {
	'a cut of the whole row': row(UNDER_PARAGRAPH, [1, 0], {
		to: 6,
		gesture: { remove: 'cut' },
		bytes: EMPTIED
	}),
	'Backspace over the whole row': row(UNDER_PARAGRAPH, [1, 0], {
		to: 6,
		gesture: { remove: 'Backspace' },
		bytes: EMPTIED
	})
};

type Editor = MountedEditor<EditorTestSurface>;

/** A Backspace or Delete the way a browser delivers it: where the editor takes neither the keydown
 *  nor `beforeinput`, the browser's own removal and its `input`, which jsdom doesn't perform. */
async function deleteBy(el: HTMLElement, key: 'Backspace' | 'Delete'): Promise<void> {
	if ((await pressHardwareKey(el, { key })) !== 'browser') return;
	const range = window.getSelection()!.getRangeAt(0);
	if (range.collapsed && key === 'Backspace')
		range.setStart(range.startContainer, range.startOffset - 1);
	else if (range.collapsed) range.setEnd(range.endContainer, range.endOffset + 1);
	range.deleteContents();
	const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';
	el.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
	await settleEditor();
}

async function perform(editor: Editor, { path, from, to, gesture }: Row): Promise<void> {
	const el = surfaceAt(editor, path);
	if (to === undefined) placeCaret(el, from);
	else selectRange(el, from, to);
	await editor.settle();
	if ('type' in gesture) await insertBy(gesture.by ?? 'hardware key', el, gesture.type);
	else if (gesture.remove === 'cut') await clipboardGesture(editor, 'cut', 'key');
	else await deleteBy(el, gesture.remove);
	await editor.settle();
}

/** The source's bytes with the gesture's text spliced in where a text editor would put it. */
function plainSplice(editor: Editor, { source, path, from, to, gesture }: Row): string {
	const byte = (offset: number) => editor.instance.__test.byteOf(path, offset)!;
	const typed = 'type' in gesture ? gesture.type : '';
	const collapsed = to === undefined && 'remove' in gesture;
	const start = byte(collapsed && gesture.remove === 'Backspace' ? from - 1 : from);
	const end = byte(collapsed && gesture.remove === 'Delete' ? from + 1 : (to ?? from));
	return source.slice(0, start) + typed + source.slice(end);
}

const contentLines = (bytes: string): string[] =>
	displayLines(bytes)
		.map((line) => line.text)
		.filter((text) => !isBlankText(text));

/** The lines of `after` that `before` doesn't account for, each line of `before` used once. */
function linesBeyond(before: string, after: string): string[] {
	const left = contentLines(before);
	return contentLines(after).filter((line) => {
		const at = left.indexOf(line);
		if (at >= 0) left.splice(at, 1);
		return at < 0;
	});
}

const kindsOf = (editor: Editor): string[] =>
	editor.instance.__test.getDocument().children.map((block) => block.kind);

function check(rows: Record<string, Row>): void {
	for (const mode of MODES)
		for (const [name, given] of Object.entries(rows))
			it(`${mode}: ${name}`, async () => {
				if (given.bare) activateDirectives();
				const editor = mountEditor<EditorTestSurface>({
					source: given.source,
					presentationMode: mode,
					plugins: given.bare ? [] : SYNTAX_PLUGINS
				});
				await editor.settle();
				takeDevWarns();
				if (given.bare) expect(kindsOf(editor)).toContain('directiveContainer');
				const spliced = plainSplice(editor, given);

				await perform(editor, given);

				const after = editor.source();
				const { getDocument, getGrammar } = editor.instance.__test;
				if (mode === 'source') expect(after).toBe(given.bytes ?? spliced);
				// The edited line may read anew; every other line stands once, as it did.
				expect(linesBeyond(given.source, after).length).toBeLessThanOrEqual(1);
				expect(linesBeyond(after, given.source).length).toBeLessThanOrEqual(1);
				expect(describeConvergence(getDocument(), getGrammar())).toBeNull();
				expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);

				await runHistory(editor, 'undo');
				expect(editor.source()).toBe(given.source);
				await runHistory(editor, 'redo');
				expect(editor.source()).toBe(after);
				expect(describeConvergence(getDocument(), getGrammar())).toBeNull();
			});
}

describe('an edit on an opener line', () => check(OPENER_ROWS));
describe('a list that gives up a lazy line', () => check(LAZY_LINE_ROWS));
describe('an opener line emptied', () => check(EMPTIED_ROWS));
