// @vitest-environment jsdom
// A container drawn by a DOM view holds editable children like the same container drawn by a
// Svelte component: each row runs over the GitHub alert's `AdmonitionBlock` and a DOM alert.
// Miss-analysis: new surface; the rows the scratch probe proved, kept so the two forms can't drift.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
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
import {
	defineBlockView,
	definePlugin,
	type BlockView,
	type ContainerViewContext
} from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerGithubAlert } from '#packages/admonitions/src/github-alert-kind.js';
import { registerAdmonitions } from '#packages/admonitions/src/admonition-kind.js';
import AdmonitionBlock from '#packages/admonitions/src/AdmonitionBlock.svelte';
import { loggedHandle, newViewLog, type ViewLog } from './fixtures/dom-views';

const SOURCE = '> [!NOTE]\n> first\n>\n> second\n\nafter\n';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** The alert's box and badge drawn by hand; `mountChildren` decides when the children arrive. */
function domAlert(
	log: ViewLog = newViewLog(),
	mountChildren = (target: HTMLElement, ctx: ContainerViewContext) =>
		ctx.container.mountChildren(target)
): BlockView {
	return defineBlockView({
		surface: 'container',
		mount(target, ctx) {
			target.className = 'admonition';
			const badge = document.createElement('div');
			badge.className = 'admonition-title';
			badge.contentEditable = 'false';
			target.append(badge);
			mountChildren(target, ctx);
			return loggedHandle(log, target);
		}
	});
}

const FORMS: { form: string; view: () => BlockView }[] = [
	{ form: 'a Svelte component', view: () => svelteBlockView(AdmonitionBlock) },
	{ form: 'a DOM view', view: () => domAlert() }
];

function mountAlert(view: BlockView): MountedEditor<BlockLookup> {
	const plugin = definePlugin({ name: 'view-alert', setup: () => registerGithubAlert(view) });
	return mountEditor<BlockLookup>({ source: SOURCE, plugins: [plugin] });
}

describe.each(FORMS)('a container drawn by $form', ({ view }) => {
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

describe.each(FORMS)('a directive container drawn by $form', ({ view }) => {
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

describe('a DOM container view', () => {
	// The children read the editor's contexts through `mount`'s `context`; from an event handler
	// there is no component around the call to inherit them from.
	it('mounts its children from a click after mount, and they edit', async () => {
		const editor = mountAlert(
			domAlert(newViewLog(), (target, ctx) =>
				target.addEventListener('click', () => ctx.container.mountChildren(target), { once: true })
			)
		);
		await editor.settle();
		expect(blockHostAt(editor, [0]).querySelector('[data-block-path="[0,0]"]')).toBeNull();
		blockHostAt(editor, [0]).querySelector<HTMLElement>('.admonition')!.click();
		flushSync();
		await editor.settle();
		typeInto(surfaceAt(editor, [0, 0]), 'firstX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('first', 'firstX'));
	});

	// A container's raw changes with each edit inside it, so its view pays one update per key.
	it('gets one update per keystroke in a child', async () => {
		const log = newViewLog();
		const editor = mountAlert(domAlert(log));
		await editor.settle();
		typeInto(surfaceAt(editor, [0, 0]), 'firstX');
		await editor.settle();
		typeInto(surfaceAt(editor, [0, 0]), 'firstXY');
		await editor.settle();
		expect(log.raws).toEqual([
			'> [!NOTE]\n> firstX\n>\n> second\n',
			'> [!NOTE]\n> firstXY\n>\n> second\n'
		]);
		expect(log.mounts).toHaveLength(1);
	});

	// A Vue `<BlockChildren>` calls its ref again on every re-render, with the box it already gave.
	it('keeps its children when handed the box they are already in', async () => {
		const editor = mountAlert(
			defineBlockView({
				surface: 'container',
				mount(target, ctx) {
					ctx.container.mountChildren(target);
					return { update: () => ctx.container.mountChildren(target) };
				}
			})
		);
		await editor.settle();
		const child = surfaceAt(editor, [0, 0]);
		typeInto(child, 'firstX');
		await editor.settle();
		expect(surfaceAt(editor, [0, 0])).toBe(child);
	});
});
