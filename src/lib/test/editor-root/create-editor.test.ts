// @vitest-environment jsdom
// The framework-free mount through the real editor: what `update` changes, what it leaves alone,
// and what `destroy` leaves behind.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createEditor, type CreateEditorOptions, type EditorHandle } from '#lib/index.js';
import {
	EDITOR_OPTION_SPECS,
	type EditorOptions,
	type EditorOptionSpec,
	type EditorOptionSpecs
} from '#lib/editor-props.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { settleEditor, pressKey } from '#lib/test/harness/settle.js';
import { CODE_RUN_LABEL } from '#lib/a11y-strings.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { latexPlugin } from '#packages/latex/src/index.js';

installLayoutStubs();

const handles: EditorHandle[] = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	document.body.replaceChildren();
});

function create(options: CreateEditorOptions = {}): { editor: EditorHandle; target: HTMLElement } {
	const target = document.createElement('div');
	document.body.append(target);
	const editor = createEditor(target, options);
	handles.push(editor);
	flushSync();
	return { editor, target };
}

async function update(editor: EditorHandle, options: Partial<CreateEditorOptions>): Promise<void> {
	editor.update(options);
	flushSync();
	await settleEditor();
}

const rootOf = (target: HTMLElement) => target.querySelector<HTMLElement>('.editor')!;

function headerWithInput(): { header: HTMLElement; input: HTMLInputElement } {
	const header = document.createElement('div');
	const input = document.createElement('input');
	header.append(input);
	return { header, input };
}

// Never called: each `@ts-expect-error` is an assertion, and `npm run check` fails once it's unused.
export function compileTimePins(): void {
	// @ts-expect-error an option added to EditorOptions without a row
	const added: EditorOptionSpecs<EditorOptions & { header?: unknown; added?: string }> =
		EDITOR_OPTION_SPECS;
	// @ts-expect-error a boolean option whose row doesn't say so
	const unflagged: EditorOptionSpec<boolean | undefined> = { timing: 'live' };
	// @ts-expect-error a row calling an option boolean when it isn't
	const flagged: EditorOptionSpec<string | undefined> = { timing: 'live', boolean: true };
	void [added, unflagged, flagged];
}

describe('createEditor', () => {
	it('mounts the source into the target', () => {
		const { editor, target } = create({ source: '# Hi\n\nthere\n' });

		expect(editor.getSource()).toBe('# Hi\n\nthere\n');
		expect(rootOf(target)).not.toBeNull();
	});

	it('repaints a theme passed to update, and treats an equal value as no change', async () => {
		const { editor, target } = create({ source: 'a\n', theme: 'dark' });
		const themes: string[] = [];
		editor.getEvents().on('themeChange', (theme) => themes.push(theme));

		await update(editor, { theme: 'light' });
		await update(editor, { theme: 'light' });

		expect(rootOf(target).dataset.editorTheme).toBe('light');
		expect(themes).toEqual(['light']);
	});

	it('clears an option passed as undefined', async () => {
		const { editor, target } = create({ source: '', placeholder: 'Write something' });
		const hinted = () =>
			target.querySelector('[data-placeholder]')?.getAttribute('data-placeholder');
		expect(hinted()).toBe('Write something');

		await update(editor, { placeholder: undefined });

		expect(hinted()).toBeUndefined();
	});

	it('with no source, mounts what an empty source mounts', () => {
		const empty = create({ source: '' }).editor.getSource();

		expect(create().editor.getSource()).toBe(empty);
	});

	it('keeps the document for a source passed as undefined', async () => {
		const { editor } = create({ source: '# Kept\n' });

		await update(editor, { source: undefined });

		expect(editor.getSource()).toBe('# Kept\n');
	});

	it('ignores plugins passed after mount', async () => {
		const { editor } = create({ source: '$$\nx\n$$\n' });
		const catalogue = editor.getInsertCatalogue().length;

		await update(editor, { plugins: [latexPlugin()] });
		await update(editor, { source: '$$\ny\n$$\n' });

		expect(editor.getBlockKindAt([0])).toBe('paragraph');
		expect(editor.getInsertCatalogue().length).toBe(catalogue);
	});
});

describe('a hook passed to update', () => {
	it('is the one a block built before the update calls', async () => {
		const first = vi.fn();
		const newest = vi.fn();
		const { editor, target } = create({
			source: '```js\nx\n```\n',
			presentationMode: 'live',
			onRunCode: first
		});
		await settleEditor();

		await update(editor, { onRunCode: newest });
		target.querySelector<HTMLButtonElement>(`button[aria-label="${CODE_RUN_LABEL}"]`)!.click();

		expect([first.mock.calls.length, newest.mock.calls.length]).toEqual([0, 1]);
	});

	it('repaints nothing when only its identity changed', async () => {
		const resolve = (url: string) => `https://cdn.test/${url}`;
		const newest = vi.fn(resolve);
		const { editor, target } = create({
			source: 'a ![x](a.png) b\n',
			presentationMode: 'live',
			resolveImageUrl: resolve
		});
		await settleEditor();

		await update(editor, { resolveImageUrl: newest });

		expect(newest).not.toHaveBeenCalled();
		expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/a.png');
	});
});

describe('the header element', () => {
	it('sits inside the editor root, and its input keeps its own keys', async () => {
		const { header, input } = headerWithInput();
		const { target } = create({ source: 'a\n', header });

		expect(rootOf(target).contains(input)).toBe(true);
		input.focus();
		const bold = await pressKey(input, { key: 'b', ctrlKey: true });
		expect(bold.defaultPrevented).toBe(false);
	});

	it('swaps for the element passed to update, and goes with null', async () => {
		const first = headerWithInput().header;
		const next = headerWithInput().header;
		const { editor, target } = create({ source: 'a\n', header: first });

		await update(editor, { header: next });
		expect([first.isConnected, rootOf(target).contains(next)]).toEqual([false, true]);

		await update(editor, { header: null });
		expect(next.isConnected).toBe(false);
	});

	it('keeps its input focused when the same element is passed again', async () => {
		const { header, input } = headerWithInput();
		const { editor } = create({ source: 'a\n', header });
		input.focus();

		await update(editor, { header });

		expect(document.activeElement).toBe(input);
	});
});

describe('destroy', () => {
	it('empties the target and detaches the header, and a second call does nothing', () => {
		const { header } = headerWithInput();
		const { editor, target } = create({ source: 'a\n', header });

		editor.destroy();
		editor.destroy();

		expect(target.childNodes.length).toBe(0);
		expect(header.isConnected).toBe(false);
	});

	it('leaves a held handler unheard from when update runs afterwards', async () => {
		const { editor } = create({ source: 'a\n', theme: 'dark' });
		const heard = vi.fn();
		editor.getEvents().on('themeChange', heard);

		editor.destroy();
		await update(editor, { theme: 'light' });

		expect(heard).not.toHaveBeenCalled();
	});
});

// G1.94: a framework wrapper that skips `destroy` (a StrictMode remount, say) stacks two editors.
describe('a second editor in one target', () => {
	function mountTwice(destroyFirst: boolean): string[] {
		const { editor, target } = create({ source: 'a\n' });
		if (destroyFirst) editor.destroy();
		handles.push(createEditor(target, { source: 'a\n' }));
		flushSync();
		return takeDevWarns().map((record) => record.tag);
	}

	it('warns while the first is still mounted', () => {
		expect(mountTwice(false)).toEqual(['target-occupied']);
	});

	it('mounts quietly once the first is destroyed', () => {
		expect(mountTwice(true)).toEqual([]);
	});
});
