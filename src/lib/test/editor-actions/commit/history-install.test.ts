// @vitest-environment jsdom
// An undo or redo puts its entry's bytes back and nothing else: no write lands while it installs.
// Miss-analysis: every undo row checked a single undo's bytes, never what the caret's move off a
// block wrote, so an empty heading repairing itself on blur cleared the redo stack unseen.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { endTypingBatchesForTests } from '#lib/editor-actions/commit/text-batch.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import type { MathRenderer } from '#packages/latex/src/math-renderer.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

async function type(editor: MountedEditor, path: number[], offset: number, key: string) {
	const el = surfaceAt(editor, path);
	placeCaret(el, offset);
	await pressHardwareKey(el, { key });
	await editor.settle();
	endTypingBatchesForTests();
}

async function run(editor: MountedEditor, command: string): Promise<string> {
	editor.instance.runCommand(command);
	await editor.settle();
	return editor.source();
}

describe('an undo whose caret move leaves an empty heading', () => {
	it('keeps the heading, and redo gets back to the end', async () => {
		const editor = mountEditor({ source: '#\n\nb\n', presentationMode: 'source' });
		await editor.settle();
		await type(editor, [1], 1, 'c');
		await type(editor, [0], 1, 'x');

		const states = [];
		for (const command of ['history.undo', 'history.undo', 'history.redo', 'history.redo']) {
			states.push(await run(editor, command));
		}

		expect(states).toEqual(['#\n\nbc\n', '#\n\nb\n', '#\n\nbc\n', '#x\n\nbc\n']);
	});
});

describe('an undo with a draft open', () => {
	const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

	const shownSource = (editor: MountedEditor) =>
		editor.target.querySelector<HTMLElement>('.math-block-source');

	/** A formula whose shown source holds an edit to `new` that nothing has committed yet. */
	async function editedSource(): Promise<MountedEditor> {
		const editor = mountEditor<{
			getBlockComponent(path: number[]): { parkCaret?(offset: number): void } | null;
		}>({
			source: 'a\n\n$$\nold\n$$\n',
			presentationMode: 'live',
			plugins: [latexPlugin({ renderer: stubRenderer })]
		});
		await editor.settle();
		await type(editor, [0], 1, 'b');
		editor.instance.__test.getBlockComponent([1])!.parkCaret!(0);
		await editor.settle();
		const source = shownSource(editor);
		expect(source, 'the block opened no source view').not.toBeNull();
		source!.textContent = '$$\nnew\n$$';
		source!.focus();
		return editor;
	}

	it('commits the draft as a step of its own, which the undo takes back and redo returns', async () => {
		const editor = await editedSource();

		expect(await run(editor, 'history.undo')).toBe('ab\n\n$$\nold\n$$\n');
		expect(await run(editor, 'history.redo')).toBe('ab\n\n$$\nnew\n$$\n');
		await run(editor, 'history.undo');
		expect(await run(editor, 'history.undo')).toBe('a\n\n$$\nold\n$$\n');
	});

	// Miss-analysis: the row above stopped at the redo, and no row edited the source it refilled.
	it('saves an edit made after the redo refills the shown source', async () => {
		const editor = await editedSource();
		await run(editor, 'history.undo');
		await run(editor, 'history.redo');
		const source = shownSource(editor);
		expect(source?.textContent, 'the redo refilled the shown source').toBe('$$\nnew\n$$');
		source!.textContent = '$$\nnewer\n$$';
		source!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();

		expect(editor.source()).toBe('ab\n\n$$\nnewer\n$$\n');
	});
});

// The install declines every write while it runs, so it must end inside the task that started
// it: a key is its own task, and one landing inside would be dropped.
describe('the install spans no input event', () => {
	it('a key pressed in the task after an undo starts lands after it', async () => {
		const editor = mountEditor({ source: 'ab\n', presentationMode: 'source' });
		await editor.settle();
		await type(editor, [0], 2, 'x');

		editor.instance.runCommand('history.undo');
		await new Promise<void>((done) =>
			setTimeout(() => {
				const el = surfaceAt(editor, [0]);
				placeCaret(el, 2);
				void pressHardwareKey(el, { key: 'q' }).then(() => done());
			}, 0)
		);
		await editor.settle();

		expect(editor.source()).toBe('abq\n');
	});
});
