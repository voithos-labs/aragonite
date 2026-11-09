// @vitest-environment jsdom
// A text block's `draw` edits like a text block a Svelte component draws: the plain rows run over
// both, then what only the draw host does (a redraw, a picture that opens on a click, a painted
// source, `ctx.typed`) and the text element's dev check.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey, pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { newestEntryCaret } from '../../harness/undo-entry';
import { blockContentElAt } from '#lib/caret/block-el-lookup.js';
import { VIEW_TEXT_ATTR } from '#lib/caret/block-content-selector.js';
import {
	definePlugin,
	lineBlock,
	type Block,
	type EditorPlugin,
	type TextDrawContext
} from '#lib/plugin.js';
import type { LineBlockSpec } from '#lib/schema/block-shapes.js';
import { svelteBlockView } from '#lib/svelte.js';
import type { BlockComponent } from '#lib/block-component.js';
import { markerLeafPlugin } from '../fixtures/dom-views';
import PlainLeafBlock from '../fixtures/PlainLeafBlock.svelte';

const SOURCE = 'intro\n\n@@ abcd\n\noutro\n';
const LEAF = [1];

type Seam = {
	getBlockComponent(path: number[]): BlockComponent | null;
	ownsRange(): boolean;
	getUndoStack(): { undo: unknown[] };
};

beforeEach(() => {
	installLayoutStubs();
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** A plugin whose `@@ ` line is one block type drawn by `spec.draw`. */
function marked(spec: Partial<LineBlockSpec<never>>) {
	return definePlugin({
		name: 'marked',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				lineBlock({
					name: 'leaf',
					label: 'Leaf',
					match: /^@@ (?<text>.*)$/,
					sample: '@@ hi',
					insert: { none: 'a test block type' },
					...spec
				} as LineBlockSpec<never>)
			]
		})
	});
}

/** A badge before the editor's text element: chrome the caret and every offset must step past. */
function badged(ctx: TextDrawContext) {
	const dom = document.createElement('div');
	const badge = document.createElement('span');
	badge.textContent = 'memo';
	dom.append(badge, ctx.source);
	return { dom };
}

type AnyPlugin = EditorPlugin | ReturnType<typeof marked>;

const mount = (plugin: AnyPlugin, source = SOURCE) =>
	mountEditor({ source, plugins: [plugin] }) as MountedEditor<Seam>;

function paste(target: EventTarget, text: string): void {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	target.dispatchEvent(e);
}

const FORMS: { form: string; plugin: () => AnyPlugin }[] = [
	{ form: 'a Svelte component', plugin: () => markerLeafPlugin(svelteBlockView(PlainLeafBlock)) },
	{ form: 'draw', plugin: () => marked({ edit: 'text', draw: (_block, ctx) => badged(ctx) }) }
];

describe.each(FORMS)('a plain text block drawn by $form', ({ plugin }) => {
	it('is one editable text node holding the block’s text, as a textbox', async () => {
		const editor = mount(plugin());
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		expect(el.getAttribute('contenteditable')).toBe('true');
		expect(el.getAttribute('role')).toBe('textbox');
		expect(el.textContent).toBe('@@ abcd');
		expect(el.childNodes).toHaveLength(1);
		expect(blockContentElAt(editor.target, LEAF)).toBe(el);
	});

	it('commits what is typed, and Ctrl+Z writes the old text back into the element', async () => {
		const editor = mount(plugin());
		await editor.settle();
		typeInto(surfaceAt(editor, LEAF), '@@ abcdX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdX'));

		await pressKey(surfaceAt(editor, LEAF), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
		expect(surfaceAt(editor, LEAF).textContent).toBe('@@ abcd');
	});

	// A mode switch rebuilds the element's attributes; the attachment that moves focus away on
	// unmount must not run for it.
	it('keeps focus in the element across a switch to live mode', async () => {
		const editor = mount(plugin());
		await editor.settle();
		placeCaret(surfaceAt(editor, LEAF), 4);
		editor.props.presentationMode = 'live';
		await editor.settle();
		expect(document.activeElement).toBe(surfaceAt(editor, LEAF));
	});

	it('replaces a range with a paste, and its undo caret is where the paste began', async () => {
		const editor = mount(plugin());
		await editor.settle();
		const el = surfaceAt(editor, LEAF);
		placeCaret(el, 6);
		dispatchKey(el, { key: 'Shift' });
		selectRange(el, 4, 6);
		paste(el, 'Z');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'aZd'));
		expect(newestEntryCaret(editor)).toEqual({ path: LEAF, offset: 4 });
	});

	it('goes inert in reading mode and editable again after it', async () => {
		const editor = mount(plugin());
		await editor.settle();
		editor.props.presentationMode = 'reading';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).getAttribute('contenteditable')).toBe('false');
		editor.props.presentationMode = 'source';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).getAttribute('contenteditable')).toBe('true');
		expect(surfaceAt(editor, LEAF).getAttribute('role')).toBe('textbox');
	});

	it('draws the new document’s block after a source swap', async () => {
		const editor = mount(plugin());
		await editor.settle();
		const before = surfaceAt(editor, LEAF);
		editor.props.source = 'intro\n\n@@ other\n';
		await editor.settle();
		expect(surfaceAt(editor, LEAF).textContent).toBe('@@ other');
		expect(before.isConnected && before.textContent === '@@ abcd').toBe(false);
	});
});

describe('a drawn text block', () => {
	it('is drawn again into a fresh element when update returns false, and still takes typing', async () => {
		const doms: HTMLElement[] = [];
		const editor = mount(
			marked({
				edit: 'text',
				draw: (_block, ctx) => {
					const drawn = badged(ctx);
					doms.push(drawn.dom);
					return { ...drawn, update: (next) => !next.text.includes('!') };
				}
			})
		);
		await editor.settle();
		typeInto(surfaceAt(editor, LEAF), '@@ abcd!');
		await editor.settle();
		expect(doms).toHaveLength(2);
		expect(doms[0].isConnected).toBe(false);

		typeInto(surfaceAt(editor, LEAF), '@@ abcd!?');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcd!?'));
	});

	// Miss-analysis: the descent to the text element had rows for focus and offsets, none for a measure.
	it('measures the whole drawing for rects.blockRect, badge included', async () => {
		const editor = mount(marked({ edit: 'text', draw: (_block, ctx) => badged(ctx) }));
		await editor.settle();
		const text = surfaceAt(editor, LEAF);
		const content = blockContentElAt(editor.target, LEAF)!.closest<HTMLElement>(
			'[data-block-path] > *'
		)!;
		content.getBoundingClientRect = () => new DOMRect(0, 10, 300, 40);
		text.getBoundingClientRect = () => new DOMRect(0, 30, 300, 20);
		expect(editor.instance.getRects().blockRect(LEAF)?.height).toBe(40);
	});

	it('that puts an element inside the text element fails the dev check', async () => {
		const editor = mount(
			marked({
				edit: 'text',
				draw: (_block, ctx) => {
					ctx.source.append(document.createElement('b'));
					return badged(ctx);
				}
			})
		);
		await editor.settle();
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:dom-view-content');
	});
});

describe('a drawn picture that opens its text (edit: source)', () => {
	/** A picture of the line before the editor's text element, logging what each `update` sees. */
	function picture(spec: Partial<LineBlockSpec<never>> = {}, seen: Seen[] = []) {
		return marked({
			draw: (block: Block<never>, ctx: TextDrawContext) => {
				const dom = document.createElement('div');
				const shown = document.createElement('output');
				shown.className = 'picture';
				shown.textContent = block.text;
				dom.append(shown, ctx.source);
				return {
					dom,
					update: (next: Block<never>, now: TextDrawContext) => {
						shown.textContent = next.text;
						seen.push({ focused: now.focused, typed: now.typed });
					}
				};
			},
			...spec
		} as Partial<LineBlockSpec<never>>);
	}

	const pictureOf = (editor: MountedEditor) =>
		blockHostAt(editor, LEAF).querySelector<HTMLElement>('.picture')!;
	const shownSource = (editor: MountedEditor) => {
		const el = blockHostAt(editor, LEAF).querySelector<HTMLElement>(`[${VIEW_TEXT_ATTR}]`);
		return el?.hidden ? null : el;
	};
	const offsetIn = (editor: MountedEditor<Seam>) =>
		editor.instance.__test.getBlockComponent(LEAF)?.getCursorOffset?.();

	/** A real click: pointer-down records where it landed, and the click opens the text. */
	async function click(editor: MountedEditor, init: MouseEventInit = {}) {
		const at = { bubbles: true, cancelable: true, clientX: 30, clientY: 10, ...init };
		pictureOf(editor).dispatchEvent(new PointerEvent('pointerdown', at));
		pictureOf(editor).dispatchEvent(new MouseEvent('click', at));
		await editor.settle();
	}

	/** Edit the shown text the way a browser's own input would, then move focus away. */
	async function editAndBlur(editor: MountedEditor, text: string) {
		const el = shownSource(editor)!;
		el.textContent = text;
		el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
	}

	const typedSeen = (seen: Seen[]) =>
		seen.map((one) => one.typed).filter((text, i, all) => text !== null && text !== all[i - 1]);

	it('writes nothing while open, and its text once as the caret leaves, as one undo step', async () => {
		const editor = mount(picture());
		await editor.settle();
		const depth = () => editor.instance.__test.getUndoStack().undo.length;
		await click(editor);
		const before = depth();
		const el = shownSource(editor)!;
		for (const text of ['@@ abcdX', '@@ abcdXY']) {
			el.textContent = text;
			el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
			await editor.settle();
		}
		expect(editor.source()).toBe(SOURCE);

		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdXY'));
		expect(depth() - before).toBe(1);
		await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
		expect(editor.source()).toBe(SOURCE);
	});

	it('opens where its caret function puts the point, and at the line’s start without a caret', async () => {
		const caret = vi.fn(() => 2);
		const at = mount(
			marked({
				draw: (_block: Block<never>, ctx: TextDrawContext) => ({ ...pictureDom(ctx), caret })
			})
		);
		await at.settle();
		await click(at);
		expect(caret).toHaveBeenCalledWith({ x: 30, y: 10 });
		// The function's offset counts in the block's text, which starts after `@@ `.
		expect(offsetIn(at)).toBe(5);
		await at.destroy();

		const none = mount(
			marked({ draw: (_block: Block<never>, ctx: TextDrawContext) => pictureDom(ctx) })
		);
		await none.settle();
		await click(none);
		expect(offsetIn(none)).toBe(0);
	});

	it('keeps a live range on a shift-click, and the plain click after it opens the text and ends it', async () => {
		const editor = mount(picture());
		await editor.settle();
		const intro = surfaceAt(editor, [0]);
		intro.focus();
		await pressKey(intro, { key: 'a', ctrlKey: true });
		await pressKey(intro, { key: 'a', ctrlKey: true });
		expect(editor.instance.__test.ownsRange()).toBe(true);

		await click(editor, { shiftKey: true });
		expect(editor.instance.__test.ownsRange()).toBe(true);
		expect(shownSource(editor)).toBeNull();

		await click(editor);
		expect(editor.instance.__test.ownsRange()).toBe(false);
		expect(shownSource(editor)).not.toBeNull();
	});

	it('paints its shown text through renderSource on every opening, its bytes kept', async () => {
		const editor = mount(
			picture({
				renderSource: (text) => {
					const frag = document.createDocumentFragment();
					frag.appendChild(document.createElement('span')).textContent = text;
					return frag;
				}
			})
		);
		await editor.settle();
		await click(editor);
		expect(shownSource(editor)?.querySelector('span')?.textContent).toBe('@@ abcd');
		shownSource(editor)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await editor.settle();
		await click(editor);
		expect(shownSource(editor)?.querySelector('span')?.textContent).toBe('@@ abcd');
	});

	// The edit the text still held lands as a step of its own first, which the undo takes back.
	it('hands update the text a document undo fills the open text with, as typed', async () => {
		const seen: Seen[] = [];
		const editor = mount(picture({}, seen));
		await editor.settle();
		await click(editor);
		await editAndBlur(editor, '@@ abcdX');
		await click(editor);
		const el = shownSource(editor)!;
		el.textContent = '@@ abcdXY';
		el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
		await editor.settle();
		await pressKey(el, { key: 'z', ctrlKey: true });

		expect(shownSource(editor)?.textContent).toBe('@@ abcdX');
		expect(typedSeen(seen)).toEqual(['@@ abcdXY', '@@ abcdX']);
	});

	it('hands update no typed text for an opening after an undo changed it while folded', async () => {
		const seen: Seen[] = [];
		const editor = mount(picture({}, seen));
		await editor.settle();
		await click(editor);
		await editAndBlur(editor, '@@ abcdX');
		await pressKey(surfaceAt(editor, [0]), { key: 'z', ctrlKey: true });
		await click(editor);

		expect(shownSource(editor)?.textContent).toBe('@@ abcd');
		expect(seen.at(-1)).toEqual({ focused: true, typed: null });
		expect(typedSeen(seen)).toEqual([]);
	});
});

type Seen = { focused: boolean; typed: string | null };

/** The picture's markup alone, for a row that adds its own `caret`. */
function pictureDom(ctx: TextDrawContext) {
	const dom = document.createElement('div');
	const shown = document.createElement('output');
	shown.className = 'picture';
	dom.append(shown, ctx.source);
	return { dom };
}
