// @vitest-environment jsdom
// The `placeholder` prop through the real editor: which empty block shows a hint and with what
// text, and that a hint never touches the bytes, the undo stack or the caret.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import type { EditorProps, PlaceholderBlock } from '$lib/editor-props';

installLayoutStubs();
afterEach(destroyMountedEditors);

/** The hint the block at `path` paints, checked equal to what it announces. */
function hintAt(editor: MountedEditor, path: number[]): string | null {
	const el = surfaceAt(editor, path);
	const painted = el.getAttribute('data-placeholder');
	expect(el.getAttribute('aria-placeholder'), 'aria-placeholder follows the hint').toBe(painted);
	return painted;
}

/** A function form that answers with what it was asked, so the attribute shows the question. */
const echo = (block: PlaceholderBlock): string =>
	`${block.kind} ${JSON.stringify(block.path)}${block.documentEmpty ? ' document' : ''}` +
	`${block.focused ? ' focused' : ''}${block.editable ? '' : ' read-only'}`;

async function setPlaceholder(editor: MountedEditor, value: EditorProps['placeholder']) {
	editor.props.placeholder = value;
	flushSync();
	await editor.settle();
}

describe('placeholder: the string form', () => {
	it('shows on an empty document and goes on the first typed letter', async () => {
		const editor = mountEditor({ source: '', placeholder: 'Start writing' });
		expect(hintAt(editor, [0])).toBe('Start writing');

		typeInto(surfaceAt(editor, [0]), 'a');
		await editor.settle();
		expect(editor.source()).toBe('a\n');
		expect(hintAt(editor, [0])).toBeNull();
	});

	it('shows only while the whole document is that one empty block', () => {
		const twoBlocks = mountEditor({ source: '\n\nnext\n', placeholder: 'Start writing' });
		expect(hintAt(twoBlocks, [0])).toBeNull();
		const emptyItem = mountEditor({ source: '- \n', placeholder: 'Start writing' });
		expect(hintAt(emptyItem, [0, 0, 0])).toBeNull();
	});

	it('never shows in reading mode', () => {
		const editor = mountEditor({
			source: '',
			placeholder: 'Start writing',
			presentationMode: 'reading'
		});
		expect(hintAt(editor, [0])).toBeNull();
	});
});

describe('placeholder: the function form', () => {
	it('is asked about each empty block with its kind and path, and never about a full one', () => {
		const asked: string[] = [];
		const editor = mountEditor({
			source: '# \n\n- \n\n```\n\n```\n\nfull\n',
			placeholder: (block) => {
				asked.push(block.kind);
				return echo(block);
			}
		});
		expect(hintAt(editor, [0])).toBe('heading [0]');
		expect(hintAt(editor, [1, 0, 0])).toBe('paragraph [1,0,0]');
		expect(hintAt(editor, [2])).toBe('fencedCode [2]');
		expect(hintAt(editor, [3])).toBeNull();
		expect(asked.sort()).toEqual(['fencedCode', 'heading', 'paragraph']);
	});

	it('answers focused for the block the caret is in, and moves with it', async () => {
		const editor = mountEditor({ source: '\n\n\n', placeholder: echo });
		placeCaret(surfaceAt(editor, [0]), 0);
		await editor.settle();
		expect(hintAt(editor, [0])).toBe('paragraph [0] focused');
		expect(hintAt(editor, [1])).toBe('paragraph [1]');

		placeCaret(surfaceAt(editor, [1]), 0);
		await editor.settle();
		expect(hintAt(editor, [0])).toBe('paragraph [0]');
		expect(hintAt(editor, [1])).toBe('paragraph [1] focused');
	});

	it('answers documentEmpty for the one block of an empty document', () => {
		const editor = mountEditor({ source: '# \n', placeholder: echo });
		expect(hintAt(editor, [0])).toBe('heading [0] document');
	});

	it('is still asked in reading mode, as not editable', () => {
		const editor = mountEditor({ source: '\n', placeholder: echo, presentationMode: 'reading' });
		expect(hintAt(editor, [0])).toBe('paragraph [0] document read-only');
	});

	it('an answer of null or the empty string shows nothing', async () => {
		const editor = mountEditor({ source: '\n', placeholder: () => null });
		expect(hintAt(editor, [0])).toBeNull();
		await setPlaceholder(editor, () => '');
		expect(hintAt(editor, [0])).toBeNull();
	});
});

describe('placeholder: while it shows', () => {
	it('hides while an IME composes into the empty block, and returns if nothing landed', async () => {
		const editor = mountEditor({ source: '', placeholder: 'Start writing' });
		const el = surfaceAt(editor, [0]);
		placeCaret(el, 0);
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		await editor.settle();
		expect(hintAt(editor, [0])).toBeNull();

		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
		await editor.settle();
		expect(hintAt(editor, [0])).toBe('Start writing');
	});

	it('a prop change repaints the mounted block without remounting it', async () => {
		const editor = mountEditor({ source: '', placeholder: 'First' });
		const el = surfaceAt(editor, [0]);

		await setPlaceholder(editor, 'Second');
		expect(surfaceAt(editor, [0])).toBe(el);
		expect(hintAt(editor, [0])).toBe('Second');

		await setPlaceholder(editor, undefined);
		expect(surfaceAt(editor, [0])).toBe(el);
		expect(hintAt(editor, [0])).toBeNull();
	});

	it('changes no byte, undo entry or caret as it comes, moves and goes', async () => {
		const editor = mountEditor({ source: '\n\n\n' });
		const undoDepth = () =>
			(
				editor.instance as unknown as { __test: { getUndoStack(): { undo: unknown[] } } }
			).__test.getUndoStack().undo.length;
		placeCaret(surfaceAt(editor, [1]), 0);
		await editor.settle();
		const before = {
			source: editor.source(),
			undo: undoDepth(),
			selection: editor.instance.getSelection()
		};

		await setPlaceholder(editor, echo);
		expect(hintAt(editor, [1])).toBe('paragraph [1] focused');
		await setPlaceholder(editor, 'Start writing');
		await setPlaceholder(editor, undefined);

		expect({
			source: editor.source(),
			undo: undoDepth(),
			selection: editor.instance.getSelection()
		}).toEqual(before);
	});
});
