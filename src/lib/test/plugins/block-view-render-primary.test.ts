// @vitest-environment jsdom
// A render-primary leaf drawn by a DOM view reveals, commits and extends like the same leaf drawn
// by `RevealLeafBlock.svelte`: each row runs over both forms, then the DOM view's own rules (G1.147).
// Miss-analysis: new surface; a reveal block existed only as a Svelte component until now.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { defineBlockView, type BlockView, type BlockViewState } from '#lib/plugin.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { UndoEntry } from '#lib/undo/types.js';
import {
	REVEAL_LEAF_FORMS,
	domRevealLeaf,
	revealLeafPlugin,
	type RevealLeafForm
} from '../blocks/fixtures/reveal-leaf';

const SOURCE = 'intro\n\n@@ abcd\n\noutro\n';
const LEAF = [1];

type Seam = {
	getBlockComponent(path: number[]): BlockComponent | null;
	getUndoStack(): { undo: UndoEntry[] };
	isCrossBlockActive(): boolean;
};

let plugins = 0;
function mount(view: RevealLeafForm | BlockView, offset: number | null = null) {
	const name = `render-primary-view-${plugins++}`;
	const caretTargetAtPoint = vi.fn(() => (offset === null ? null : { path: [], offset }));
	const plugin = revealLeafPlugin(name, view, { caretTargetAtPoint });
	const editor = mountEditor({ source: SOURCE, plugins: [plugin] }) as MountedEditor<Seam>;
	return { editor, caretTargetAtPoint };
}

const hostAt = (editor: MountedEditor, path: number[]) =>
	editor.target.querySelector<HTMLElement>(`[data-block-path="${JSON.stringify(path)}"]`)!;
const rendered = (editor: MountedEditor) =>
	hostAt(editor, LEAF).querySelector<HTMLElement>('.reveal-leaf-render');
const shownSource = (editor: MountedEditor) =>
	hostAt(editor, LEAF).querySelector<HTMLElement>('.reveal-leaf-source');

/** A real click: pointer-down records where it landed, and the click opens the source. */
async function click(editor: MountedEditor, el: HTMLElement, init: MouseEventInit = {}) {
	const at = { bubbles: true, cancelable: true, clientX: 30, clientY: 10, ...init };
	el.dispatchEvent(new PointerEvent('pointerdown', at));
	el.dispatchEvent(new MouseEvent('click', at));
	await editor.settle();
}

/** Edit the shown source the way a browser's own input would, then move focus away. */
async function editAndBlur(editor: MountedEditor, text: string) {
	const el = shownSource(editor)!;
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
	el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	await editor.settle();
}

beforeEach(() => {
	installLayoutStubs();
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

describe.each(REVEAL_LEAF_FORMS)('a render-primary plugin leaf drawn by %s', (form) => {
	it('reveals at the offset the kind names for the clicked point', async () => {
		const { editor, caretTargetAtPoint } = mount(form, 5);
		await editor.settle();
		await click(editor, rendered(editor)!);

		expect(shownSource(editor)?.textContent).toBe('@@ abcd');
		expect(document.activeElement).toBe(shownSource(editor));
		expect(editor.instance.__test.getBlockComponent(LEAF)?.getCursorOffset?.()).toBe(5);
		expect(caretTargetAtPoint).toHaveBeenCalledWith(hostAt(editor, LEAF), 30, 10);
	});

	it('commits the whole edit as one undo entry when focus leaves, and Ctrl+Z reverts it', async () => {
		const { editor } = mount(form);
		await editor.settle();
		const depth = editor.instance.__test.getUndoStack().undo.length;
		await click(editor, rendered(editor)!);
		await editAndBlur(editor, '@@ abcdXY');

		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdXY'));
		expect(editor.instance.__test.getUndoStack().undo.length).toBe(depth + 1);
		expect(shownSource(editor)).toBeNull();
		expect(rendered(editor)?.textContent).toBe('@@ abcdXY\n');

		await pressKey(hostAt(editor, [0]).querySelector<HTMLElement>('[contenteditable]')!, {
			key: 'z',
			ctrlKey: true
		});
		expect(editor.source()).toBe(SOURCE);
	});

	it('keeps a live range on a shift-click, and the plain click after it reveals and ends it', async () => {
		const { editor } = mount(form);
		await editor.settle();
		const intro = hostAt(editor, [0]).querySelector<HTMLElement>('[contenteditable]')!;
		intro.focus();
		await pressKey(intro, { key: 'a', ctrlKey: true });
		await pressKey(intro, { key: 'a', ctrlKey: true });
		expect(editor.instance.__test.isCrossBlockActive()).toBe(true);

		await click(editor, rendered(editor)!, { shiftKey: true });
		expect(editor.instance.__test.isCrossBlockActive()).toBe(true);
		expect(shownSource(editor)).toBeNull();

		await click(editor, rendered(editor)!);
		expect(editor.instance.__test.isCrossBlockActive()).toBe(false);
		expect(shownSource(editor)).not.toBeNull();
	});
});

describe('a DOM render-primary view', () => {
	/** A view that hands its source over when `attachSource` says, logging each state it saw. */
	function loggingView(attachSource: (attach: () => void) => void, seen: BlockViewState[] = []) {
		return defineBlockView({
			surface: 'render-primary',
			mount(target, ctx) {
				ctx.leaf.attachRendered(target);
				const render = target.appendChild(document.createElement('div'));
				render.className = 'reveal-leaf-render';
				render.textContent = ctx.state().node.raw;
				let source: HTMLElement | null = null;
				return {
					update(state) {
						seen.push(state);
						if (!state.revealed) {
							source?.remove();
							source = null;
							ctx.leaf.attach(null);
							return;
						}
						if (source) return;
						const el = (source = target.appendChild(document.createElement('div')));
						el.className = 'reveal-leaf-source';
						attachSource(() => ctx.leaf.attach(el));
					}
				};
			}
		});
	}

	it('hears the reveal and the fold through update', async () => {
		const seen: BlockViewState[] = [];
		const { editor } = mount(loggingView((attach) => attach(), seen));
		await editor.settle();
		await click(editor, rendered(editor)!);
		await editAndBlur(editor, '@@ abcd');

		expect(seen.map((state) => state.revealed)).toEqual([true, false]);
	});

	it('lands the caret when its source arrives after the update that revealed it, and warns', async () => {
		const late = loggingView((attach) => {
			void (async () => {
				await tick();
				await tick();
				attach();
			})();
		});
		const { editor } = mount(late, 4);
		await editor.settle();
		await click(editor, rendered(editor)!);
		await editor.settle();

		expect(document.activeElement).toBe(shownSource(editor));
		expect(editor.instance.__test.getBlockComponent(LEAF)?.getCursorOffset?.()).toBe(4);
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:render-primary-attach');
	});

	it('reattaches one painted source element across reveals without a warning', async () => {
		const reused = defineBlockView({
			surface: 'render-primary',
			renderSource: (text) => {
				const frag = document.createDocumentFragment();
				frag.appendChild(document.createElement('span')).textContent = text;
				return frag;
			},
			mount(target, ctx) {
				ctx.leaf.attachRendered(target);
				const render = target.appendChild(document.createElement('div'));
				render.className = 'reveal-leaf-render';
				const source = document.createElement('div');
				source.className = 'reveal-leaf-source';
				return {
					update(state) {
						target.replaceChildren(state.revealed ? source : render);
						ctx.leaf.attach(state.revealed ? source : null);
					}
				};
			}
		});
		const { editor } = mount(reused);
		await editor.settle();
		await click(editor, rendered(editor)!);
		expect(shownSource(editor)?.querySelector('span')).not.toBeNull();
		shownSource(editor)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
		await click(editor, rendered(editor)!);

		expect(shownSource(editor)?.textContent).toBe('@@ abcd');
		expect(takeDevWarns().map((w) => w.tag)).not.toContain('invariant:dom-view-content');
	});

	// Miss-analysis: the report rows edited inside the source, and none let the document's undo refill it.
	// The edit the source still held lands as a step of its own first, which the undo takes back.
	it('runs afterInput once with the text the document’s undo fills a shown source with', async () => {
		const seen: string[] = [];
		const { editor } = mount(domRevealLeaf({ onSourceEdit: (text) => void seen.push(text) }));
		await editor.settle();
		await click(editor, rendered(editor)!);
		await editAndBlur(editor, '@@ abcdX');
		await click(editor, rendered(editor)!);
		const el = shownSource(editor)!;
		el.textContent = '@@ abcdXY';
		el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
		await pressKey(el, { key: 'z', ctrlKey: true });

		expect(shownSource(editor)?.textContent).toBe('@@ abcdX');
		expect(seen).toEqual(['@@ abcdX', '@@ abcdXY', '@@ abcdX']);
	});

	it('runs no afterInput for a reveal, after an undo changed the text while it was folded', async () => {
		const seen: string[] = [];
		const { editor } = mount(domRevealLeaf({ onSourceEdit: (text) => void seen.push(text) }));
		await editor.settle();
		await click(editor, rendered(editor)!);
		await editAndBlur(editor, '@@ abcdX');
		await pressKey(hostAt(editor, [0]).querySelector<HTMLElement>('[contenteditable]')!, {
			key: 'z',
			ctrlKey: true
		});
		await click(editor, rendered(editor)!);

		expect(shownSource(editor)?.textContent).toBe('@@ abcd');
		expect(seen).toEqual(['@@ abcdX']);
	});

	it('warns when its rendered element sits outside the element it was given', async () => {
		const stray = defineBlockView({
			surface: 'render-primary',
			mount(_target, ctx) {
				ctx.leaf.attachRendered(document.body.appendChild(document.createElement('div')));
				return {};
			}
		});
		const { editor } = mount(stray);
		await editor.settle();

		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:render-primary-attach');
	});

	it('types its surface: a spec needs mount, and only a render-primary leaf has a rendered half', () => {
		// @ts-expect-error a render-primary view has to mount
		expect(() => defineBlockView({ surface: 'render-primary' })).toThrow(/mount/);
		defineBlockView({
			surface: 'leaf',
			mount(_target, ctx) {
				// @ts-expect-error a plain leaf shows its source always, so it has no rendered half
				ctx.leaf.attachRendered(null);
				return {};
			}
		});
	});
});
