// @vitest-environment jsdom
// A block focused whole, with an edit box of its own, drawn by a DOM view: a ```` ```mermaid ````
// diagram from the process-wide registrars, its code in a `<pre>` swapped for a textarea.
// Miss-analysis: new surface; a DOM container had no focus element, no key handling without
// children and no route for command hooks, and no row ran a whole-block kind through it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	defineBlockView,
	definePlugin,
	getPluginMetadata,
	trimTrailingLineEnding,
	type BlockView,
	type ContainerViewContext
} from '#lib/plugin.js';
import { WHOLE_BLOCK_INPUT_ATTR } from '#lib/selection/whole-block-input.js';
import {
	joinMermaidBody,
	registerMermaidKind,
	type MermaidMetadata
} from '#lib/test/harness/registered-diagram.js';
import { registerGithubAlert } from '#packages/admonitions/src/github-alert-kind.js';

const SOURCE = 'above\n\n```mermaid\ngraph TD\n```\n\nbelow\n';
const DIAGRAM = [1];

type Seam = { getBlockComponent(path: number[]): { focus?(offset: number): void } };

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** The diagram's code in a `<pre>`, swapped for a textarea on a double click and back on blur,
 *  which commits. The kind's `mermaid.focus` command (Mod+M) only marks the block. */
function domDiagram(remountOn?: (code: string) => boolean): BlockView {
	return defineBlockView({
		surface: 'container',
		mount(target, ctx) {
			target.className = 'dom-diagram';
			const shown = document.createElement('pre');
			shown.tabIndex = -1;
			const code = () => getPluginMetadata<MermaidMetadata>(ctx.state().node)?.code ?? '';
			shown.textContent = code();
			target.append(shown);
			ctx.container.attachFocus(shown);
			const edit = () => openEdit(shown, ctx, code());
			shown.addEventListener('dblclick', edit);
			ctx.container.setCommandHooks({
				openEdit: edit,
				openFocusView: () => (target.dataset.focusView = '')
			});
			return {
				update: () => {
					if (remountOn?.(code())) return false;
					shown.textContent = code();
				}
			};
		}
	});
}

function openEdit(shown: HTMLElement, ctx: ContainerViewContext, code: string): void {
	const box = document.createElement('textarea');
	box.className = 'mermaid-source';
	box.value = trimTrailingLineEnding(code);
	box.addEventListener('focusout', () => {
		box.replaceWith(shown);
		ctx.container.attachFocus(shown);
		void ctx.container.updateOwnMetadata({ code: joinMermaidBody(box.value, '\n') });
	});
	shown.replaceWith(box);
	ctx.container.attachFocus(box);
	box.focus();
}

const openDomEdit = (host: HTMLElement) =>
	host.querySelector('pre')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
const focusViewOpen = (host: HTMLElement) => !!host.querySelector('[data-focus-view]');

function mountDiagram(view: BlockView): MountedEditor<Seam> {
	const plugin = definePlugin({ name: 'view-diagram', setup: () => registerMermaidKind(view) });
	return mountEditor<Seam>({ source: SOURCE, plugins: [plugin] });
}

async function focusWhole(editor: MountedEditor<Seam>): Promise<HTMLElement> {
	editor.instance.__test.getBlockComponent(DIAGRAM).focus?.(0);
	await editor.settle();
	return document.activeElement as HTMLElement;
}

async function openEditBox(
	editor: MountedEditor<Seam>,
	openEdit: (host: HTMLElement) => void
): Promise<HTMLTextAreaElement> {
	openEdit(blockHostAt(editor, DIAGRAM));
	flushSync();
	await editor.settle();
	const box = blockHostAt(editor, DIAGRAM).querySelector<HTMLTextAreaElement>('textarea');
	if (!box) throw new Error('the edit box did not open');
	return box;
}

describe('a block focused whole, drawn by a DOM view', () => {
	it('takes focus on its editing host, inside the block', async () => {
		const editor = mountDiagram(domDiagram());
		await editor.settle();
		const active = await focusWhole(editor);
		expect(blockHostAt(editor, DIAGRAM).contains(active)).toBe(true);
		expect(active.hasAttribute(WHOLE_BLOCK_INPUT_ATTR)).toBe(true);
	});

	it('puts a character typed at it in a new paragraph below', async () => {
		const editor = mountDiagram(domDiagram());
		await editor.settle();
		const host = await focusWhole(editor);
		host.dispatchEvent(
			new InputEvent('beforeinput', { inputType: 'insertText', data: '€', cancelable: true })
		);
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('```\n\nbelow', '```\n\n€\n\nbelow'));
	});

	it('deletes itself on Backspace, and Ctrl+Z brings it back', async () => {
		const editor = mountDiagram(domDiagram());
		await editor.settle();
		await pressKey(await focusWhole(editor), { key: 'Backspace' });
		expect(editor.source()).not.toContain('mermaid');
		await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
	});

	it('commits an edit in its own box as one undo entry', async () => {
		const editor = mountDiagram(domDiagram());
		await editor.settle();
		const box = await openEditBox(editor, openDomEdit);
		expect(document.activeElement).toBe(box);
		box.value = 'graph LR';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		flushSync();
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('graph TD', 'graph LR'));

		await pressKey(await focusWhole(editor), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
	});

	it('leaves a kind chord in its edit box to the box, and runs it with its hooks when focused whole', async () => {
		const editor = mountDiagram(domDiagram());
		await editor.settle();
		const box = await openEditBox(editor, openDomEdit);
		await pressKey(box, { key: 'm', ctrlKey: true });
		expect(focusViewOpen(blockHostAt(editor, DIAGRAM))).toBe(false);

		// The block takes focus whole only once its own editor has let go of it.
		box.blur();
		flushSync();
		await pressKey(await focusWhole(editor), { key: 'm', ctrlKey: true });
		flushSync();
		expect(focusViewOpen(blockHostAt(editor, DIAGRAM))).toBe(true);
	});
});

describe('a DOM view focused whole', () => {
	it('keeps an editing host in its new element when it is mounted again', async () => {
		const editor = mountDiagram(domDiagram((code) => code.includes('LR')));
		await editor.settle();
		const box = await openEditBox(editor, openDomEdit);
		box.value = 'graph LR';
		box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		flushSync();
		await editor.settle();

		const active = await focusWhole(editor);
		const target = blockHostAt(editor, DIAGRAM).querySelector('.dom-diagram')!;
		expect(target.contains(active)).toBe(true);
		expect(active.hasAttribute(WHOLE_BLOCK_INPUT_ATTR)).toBe(true);
	});

	it('throws from attachFocus on a kind not focused whole, which shows the failed block', async () => {
		const plugin = definePlugin({
			name: 'view-alert',
			setup: () =>
				registerGithubAlert(
					defineBlockView({
						surface: 'container',
						mount(target, ctx) {
							ctx.container.attachFocus(target);
							return {};
						}
					})
				)
		});
		const editor = mountEditor({ source: 'before\n', plugins: [plugin] });
		const errors: unknown[] = [];
		editor.instance.getEvents().on('error', (report) => errors.push(report.error));
		editor.props.source = '> [!NOTE]\n> body\n';
		await editor.settle();
		const failed = blockHostAt(editor, [0]).querySelector('[data-failed-block]');
		expect(failed?.textContent).toContain('> [!NOTE]');
		expect(String(errors[0])).toContain("blockFocus: 'whole-block'");
	});
});
