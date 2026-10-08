// @vitest-environment jsdom
// A character typed over a range across blocks is the range's removal, then the write a character
// typed at the caret makes: it names a new kind, finishes an on-type completion, ends a record.
// Miss-analysis: the typed character went straight to a raw commit, and the range rows checked
// only the bytes of plain letters, never a kind marker or a completer's line.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import type { EditorProps } from '#lib/editor-props.js';
import type { EditorSelection } from '#lib/selection/primitives.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** `source` in live mode with `range` drawn, and `typed` typed over it on a soft keyboard. */
async function typeOver(
	source: string,
	range: EditorSelection,
	typed: string,
	props: Partial<EditorProps> = {}
): Promise<MountedEditor> {
	const editor = mountEditor({ source, presentationMode: 'live', ...props });
	await editor.instance.setSelection(range);
	await editor.settle();
	await insertBy('soft key', surfaceAt(editor, range.focus.path), typed);
	return editor;
}

const point = (block: number, offset: number) => ({ path: [block], offset });

describe('a character typed over a range across blocks', () => {
	it('names the quote a typed `>` makes', async () => {
		const editor = await typeOver('abc\n\ndef\n', { anchor: point(0, 0), focus: point(1, 3) }, '>');

		expect(editor.source()).toBe('>\n');
		expect(blockHostAt(editor, [0]).getAttribute('data-kind-cue')).toBe('Quote');
	});

	it('finishes the math block a second `$` completes, with latex installed', async () => {
		const editor = await typeOver(
			'$abc\n\ndef\n',
			{ anchor: point(0, 1), focus: point(1, 3) },
			'$',
			{ plugins: [latexPlugin()] }
		);

		expect(editor.source()).toBe('$$\n\n$$\n');
	});

	it('leaves no line a pending break had opened', async () => {
		const editor = mountEditor({ source: 'abc\n\ndef\n', presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, 3);
		await pressKey(el, { key: 'Enter', shiftKey: true });
		await editor.instance.setSelection({ anchor: point(0, 0), focus: point(1, 3) });
		await editor.settle();

		await insertBy('soft key', surfaceAt(editor, [1]), 'x');

		expect(editor.source()).toBe('x\n');
		expect(surfaceAt(editor, [0]).querySelectorAll('br[data-caret-anchor="break"]')).toHaveLength(
			0
		);
	});
});
