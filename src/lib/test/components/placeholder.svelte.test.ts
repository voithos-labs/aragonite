// @vitest-environment jsdom
// The `placeholder` prop through the real editor: which empty block shows a hint and with what
// text, and that a hint never touches the bytes, the undo stack or the caret.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt,
	type BlockLookup,
	typeInto,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { dispatchBeforeInput } from '$lib/test/harness/insertion-routes';
import { makeSurface } from '$lib/test/harness/editable-surface';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import type { EditorProps, PlaceholderBlock } from '$lib/editor-props';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

installLayoutStubs();
afterEach(destroyMountedEditors);

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });
// One definition for every row: installing a second is refused with a warning.
const math = latexPlugin({ renderer: stubRenderer });

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

	it('asks an empty block again only when its own answer can change', async () => {
		const asked: string[] = [];
		const editor = mountEditor({
			source: '\n\n\n\nlast\n',
			placeholder: (block) => {
				asked.push(JSON.stringify(block.path));
				return block.kind;
			}
		});
		let last = 0;
		while (editor.instance.getBlockKindAt([last + 1]) !== null) last++;
		asked.length = 0;
		await pressKeyAt(editor, [last], 4, { key: 'Enter' });
		await editor.settle();
		expect(editor.instance.getBlockKindAt([last + 1])).toBe('paragraph');
		expect(new Set(asked), 'only the new empty block is asked').toEqual(
			new Set([JSON.stringify([last + 1])])
		);
	});

	it('an answer of null or the empty string shows nothing', async () => {
		const editor = mountEditor({ source: '\n', placeholder: () => null });
		expect(hintAt(editor, [0])).toBeNull();
		await setPlaceholder(editor, () => '');
		expect(hintAt(editor, [0])).toBeNull();
	});
});

describe('placeholder: fenced blocks count their body', () => {
	it('a fence with no body line is not empty, so no hint sits over its closing fence', () => {
		const editor = mountEditor({ source: '```\n```\n', placeholder: echo });
		expect(hintAt(editor, [0])).toBeNull();
	});

	it('a shown math source loses its hint on the first letter, before the source commits', async () => {
		const editor = mountEditor<BlockLookup>({
			source: '$$\n\n$$\n',
			plugins: [math],
			placeholder: (block) => block.kind
		});
		editor.instance.__test.getBlockComponent([0]).focus?.(3);
		await editor.settle();
		expect(hintAt(editor, [0])).toBe('mathBlock');

		const el = surfaceAt(editor, [0]);
		const at = asDomTextOffset(3);
		dispatchBeforeInput(el, 'insertText', {
			data: 'x',
			target: createRangeAtDomTextOffsets(el, at, at)!
		});
		await editor.settle();
		expect(editor.source()).toBe('$$\n\n$$\n');
		expect(hintAt(editor, [0])).toBeNull();
	});
});

describe('placeholder: unset', () => {
	it('reads no shown source while the prop is unset', () => {
		const { surface } = makeSurface({ overrides: { placeholder: () => null } });
		const read = vi.fn(() => '');
		surface.noteShownSource(read);
		expect(read).not.toHaveBeenCalled();
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
