// @vitest-environment jsdom
// A container drawn by a Svelte component (`svelteBlockView`) holds editable children: each row
// runs over the harness GitHub alert's `AdmonitionBlock`. A block type's own drawing places its
// children through `ctx.children` (`plugins/blocks/container-block.svelte.test.ts`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type BlockLookup,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { definePlugin, type BlockView } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerGithubAlert } from '#lib/test/harness/registered-admonitions.js';
import { registerAdmonitions } from '#lib/test/harness/registered-admonitions.js';
import { AdmonitionBlock } from '#lib/test/harness/registered-admonitions.js';

const SOURCE = '> [!NOTE]\n> first\n>\n> second\n\nafter\n';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const view = (): BlockView => svelteBlockView(AdmonitionBlock);

function mountAlert(view: BlockView): MountedEditor<BlockLookup> {
	const plugin = definePlugin({ name: 'view-alert', setup: () => registerGithubAlert(view) });
	return mountEditor<BlockLookup>({ source: SOURCE, plugins: [plugin] });
}

describe('a container drawn by a Svelte component', () => {
	it('mounts its children inside its box as editable blocks', async () => {
		const editor = mountAlert(view());
		await editor.settle();
		const box = blockHostAt(editor, [0]).querySelector('.admonition')!;
		expect(box.contains(surfaceAt(editor, [0, 0]))).toBe(true);
		expect(surfaceAt(editor, [0, 1]).textContent).toBe('second');
		expect(surfaceAt(editor, [0, 1]).getAttribute('contenteditable')).toBe('true');
	});

	it('commits typing in a child, and Ctrl+Z takes it back', async () => {
		const editor = mountAlert(view());
		await editor.settle();
		typeInto(surfaceAt(editor, [0, 0]), 'firstX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('first', 'firstX'));
		await pressKey(surfaceAt(editor, [0, 0]), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
	});

	it('puts focus(0) in its first child', async () => {
		const editor = mountAlert(view());
		await editor.settle();
		editor.instance.__test.getBlockComponent([0]).focus?.(0);
		await editor.settle();
		expect(document.activeElement).toBe(surfaceAt(editor, [0, 0]));
	});

	it('hands ArrowRight at the end of its last child to the next block', async () => {
		const editor = mountAlert(view());
		await editor.settle();
		await pressKeyAt(editor, [0, 1], 'second'.length, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(surfaceAt(editor, [1]));
	});

	it('splits a child on Enter, inside the container', async () => {
		const editor = mountAlert(view());
		await editor.settle();
		await pressKeyAt(editor, [0, 0], 'first'.length, { key: 'Enter' });
		expect(editor.source().startsWith('> [!NOTE]\n> first\n')).toBe(true);
		expect(surfaceAt(editor, [0, 2]).textContent).toBe('second');
	});
});

describe('a directive container drawn by a Svelte component', () => {
	it('resolves a chord pressed in a child against the kind’s keymap', async () => {
		const plugin = definePlugin({
			name: 'view-admonition',
			setup: () => registerAdmonitions(view())
		});
		const editor = mountEditor({ source: ':::note\nbody\n:::\n', plugins: [plugin] });
		await editor.settle();
		await pressKeyAt(editor, [0, 1], 2, { key: '7', ctrlKey: true });
		expect(editor.source()).toBe(':::tip\nbody\n:::\n');
	});
});
