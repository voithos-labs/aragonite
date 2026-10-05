// @vitest-environment jsdom
// A cut writes its copy's payload before its dispatch returns, then deletes what it copied, on
// every surface: a scripted `execCommand('cut')` (the menus' route) reads the data as it returns.
// Miss-analysis: the cut tests awaited the handler before reading the payload, so a write behind
// the hide's await read the same as one made during the event.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { dispatchKey } from '$lib/test/harness/settle';
import { newestEntryCaret } from '../support/undo-entry';
import { definePluginBlock, registerBlockOpener } from '$lib/plugin';
import { testLeaf } from '$lib/test/harness/test-kinds';
import PlainLeafBlock from '../plugins/fixtures/PlainLeafBlock.svelte';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';
import type { EditorTestSurface } from '$lib/components/editor-root-test-surface';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });
const plugins = [latexPlugin({ renderer: stubRenderer })];

beforeEach(() => {
	installLayoutStubs();
	// Showing a source measures the caret through Range rects, which jsdom lacks.
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

type Editor = MountedEditor<EditorTestSurface>;

/** Dispatches a clipboard event at `target` and returns its `text/plain` as it stood the moment
 *  dispatch returned, the only moment a scripted cut's data is readable. */
function dispatchClipboard(target: EventTarget, type: 'copy' | 'cut'): string | undefined {
	const store = new Map<string, string>();
	const e = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: {
			setData: (t: string, v: string) => void store.set(t, v),
			getData: (t: string) => store.get(t) ?? ''
		}
	});
	target.dispatchEvent(e);
	return store.get('text/plain');
}

/** Shows the inline `$x$` source at the start of the block's text and edits it in the DOM. */
async function showEditedSource(editor: Editor, surface: HTMLElement, edited: string) {
	const source = Array.from(surface.childNodes).find(
		(c): c is Text => c.nodeType === Node.TEXT_NODE && c.textContent?.includes('$x$') === true
	);
	expect(source, 'the widget source is not showing').toBeDefined();
	source!.textContent = source!.textContent!.replace('$x$', edited);
	await editor.settle();
}

interface CutRoute {
	name: string;
	source: string;
	mode?: 'source' | 'live';
	/** Puts the selection and returns the element the events go to. */
	select(editor: Editor): Promise<HTMLElement>;
	payload: string;
	/** What the cut leaves: the document, or a leaf's shown source, which writes on blur. */
	after(editor: Editor): string;
	left: string;
}

const editorRoot = (editor: Editor) => editor.target.querySelector<HTMLElement>('.editor')!;
const cell = (editor: Editor, index: number) =>
	editor.target.querySelectorAll<HTMLElement>('.table-cell')[index];

const ROUTES: CutRoute[] = [
	{
		name: 'a range in a paragraph',
		source: 'abcd\n',
		async select(editor) {
			const el = surfaceAt(editor, [0]);
			selectRange(el, 1, 3);
			return el;
		},
		payload: 'bc',
		after: (editor) => editor.source(),
		left: 'ad\n'
	},
	{
		name: 'a range inside a shown inline source in a paragraph',
		source: '$x$ b\n',
		mode: 'live',
		async select(editor) {
			editor.instance.__test.getBlockComponent([0])?.enterEdgeWidget?.('start');
			await editor.settle();
			const el = surfaceAt(editor, [0]);
			await showEditedSource(editor, el, '$xyz$');
			selectRange(el, 2, 4);
			return el;
		},
		payload: 'yz',
		after: (editor) => editor.source(),
		left: '$x$ b\n'
	},
	{
		name: 'a range in a table cell',
		source: '| h |\n| --- |\n| abcd |\n',
		async select(editor) {
			const el = cell(editor, 1);
			selectRange(el, 1, 3);
			return el;
		},
		payload: 'bc',
		after: (editor) => editor.source(),
		left: '| h |\n| --- |\n| ad |\n'
	},
	{
		name: 'a range inside a shown inline source in a table cell',
		source: '| h |\n| --- |\n| a $x$ |\n',
		async select(editor) {
			const el = cell(editor, 1);
			placeCaret(el, 5);
			dispatchKey(el, { key: 'ArrowLeft' });
			await editor.settle();
			await showEditedSource(editor, el, '$xyz$');
			selectRange(el, 4, 6);
			return el;
		},
		payload: 'yz',
		after: (editor) => editor.source(),
		left: '| h |\n| --- |\n| a $x$ |\n'
	},
	{
		name: 'a range in a code block',
		source: '```\nabcd\n```\n',
		async select(editor) {
			const el = surfaceAt(editor, [0]);
			selectRange(el, 5, 7);
			return el;
		},
		payload: 'bc',
		after: (editor) => editor.source(),
		left: '```\nad\n```\n'
	},
	{
		name: 'a range in a plugin leaf’s shown source',
		source: '$$\nabcd\n$$\n',
		async select(editor) {
			editor.instance.__test.getBlockComponent([0])?.focus?.(3);
			await editor.settle();
			const el = editor.target.querySelector<HTMLElement>('.math-block-source')!;
			expect(el, 'the math source is not showing').not.toBeNull();
			selectRange(el, 4, 6);
			return el;
		},
		payload: 'bc',
		after: (editor) =>
			editor.target.querySelector<HTMLElement>('.math-block-source')?.textContent ?? '',
		left: '$$\nad\n$$'
	},
	{
		name: 'a range across blocks, at the block holding the caret',
		source: 'abcd\n\nefgh\n',
		async select(editor) {
			await editor.instance.setSelection({
				anchor: { path: [0], offset: 1 },
				focus: { path: [1], offset: 2 }
			});
			await editor.settle();
			return surfaceAt(editor, [1]);
		},
		payload: 'bcd\n\nef',
		after: (editor) => editor.source(),
		left: 'agh\n'
	},
	{
		name: 'a range across blocks, at the editor root',
		source: 'abcd\n\nefgh\n',
		async select(editor) {
			await editor.instance.setSelection({
				anchor: { path: [0], offset: 1 },
				focus: { path: [1], offset: 2 }
			});
			await editor.settle();
			return editorRoot(editor);
		},
		payload: 'bcd\n\nef',
		after: (editor) => editor.source(),
		left: 'agh\n'
	},
	{
		name: 'a selected image, at the editor root',
		source: '![a](x.png) b\n',
		async select(editor) {
			surfaceAt(editor, [0]).focus();
			editorRoot(editor).dispatchEvent(
				new CustomEvent('image-widget-select', {
					detail: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 }
				})
			);
			await editor.settle();
			return editorRoot(editor);
		},
		payload: '![a](x.png)',
		after: (editor) => editor.source(),
		left: ' b\n'
	}
];

async function mountRoute(route: CutRoute): Promise<{ editor: Editor; target: HTMLElement }> {
	const editor: Editor = mountEditor({
		source: route.source,
		presentationMode: route.mode ?? 'source',
		plugins
	});
	await editor.settle();
	return { editor, target: await route.select(editor) };
}

// On the shown-source rows, `left` also pins that the delete takes the range the user selected,
// not the caret the hide leaves.
describe('a cut writes the copy’s payload during its event, then deletes it', () => {
	for (const route of ROUTES) {
		it(route.name, async () => {
			const { editor, target } = await mountRoute(route);

			const copied = dispatchClipboard(target, 'copy');
			const cut = dispatchClipboard(target, 'cut');
			await editor.settle();

			expect(copied).toBe(route.payload);
			expect(cut, 'the cut’s payload as its dispatch returned is not the copy’s').toBe(copied);
			expect(route.after(editor)).toBe(route.left);
		});
	}
});

/** A plain-mode editable leaf whose block is one `@@ ` line; it commits each edit as it lands. */
const plainLeaf = definePluginBlock({
	name: 'cut-plain-leaf',
	kind: 'cut-plain-leaf',
	component: PlainLeafBlock,
	register: () => {
		const kind = testLeaf('cut-plain-leaf');
		registerBlockOpener(kind, {
			priority: 25,
			interruptsParagraph: false,
			tryOpen: (ctx) =>
				ctx.line.text.startsWith('@@ ')
					? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
					: null
		});
	}
});

// A menu's Cut fires no key, so the caret the last key recorded must not stand in for the cut's.
// A selected widget is the exception below: its caret sat outside the text.
describe('a range cut’s undo caret is the range start, after a key at another caret', () => {
	const IN_BLOCK: {
		name: string;
		source: string;
		surface: (editor: Editor) => HTMLElement;
		path: number[];
		at: number;
	}[] = [
		{ name: 'a paragraph', source: 'abcd\n', surface: (e) => surfaceAt(e, [0]), path: [0], at: 1 },
		{
			name: 'a table cell',
			source: '| h |\n| --- |\n| abcd |\n',
			surface: (e) => cell(e, 1),
			path: [0, 1, 0],
			at: 1
		},
		{
			name: 'a code block',
			source: '```\nabcd\n```\n',
			surface: (e) => surfaceAt(e, [0]),
			path: [0],
			at: 5
		},
		{
			name: 'a plain plugin leaf',
			source: '@@ abcd\n',
			surface: (e) => surfaceAt(e, [0]),
			path: [0],
			at: 3
		}
	];
	for (const { name, source, surface, path, at } of IN_BLOCK) {
		it(name, async () => {
			const editor: Editor = mountEditor({ source, plugins: [plainLeaf] });
			await editor.settle();
			const el = surface(editor);
			placeCaret(el, at + 2);
			dispatchKey(el, { key: 'Shift' });
			selectRange(el, at, at + 2);

			dispatchClipboard(el, 'cut');
			await editor.settle();

			expect(newestEntryCaret(editor)).toEqual({ path, offset: at });
		});
	}
});

describe('a selected widget’s cut puts undo’s caret where it was before the widget was selected', () => {
	it('an image, at the editor root', async () => {
		const editor: Editor = mountEditor({ source: '![a](x.png) b\n' });
		await editor.settle();
		surfaceAt(editor, [0]).focus();
		editorRoot(editor).dispatchEvent(
			new CustomEvent('image-widget-select', {
				detail: { paragraphPath: [0], sourceStart: 0, preSelectOffset: 11 }
			})
		);
		await editor.settle();

		dispatchClipboard(editorRoot(editor), 'cut');
		await editor.settle();

		expect(editor.source()).toBe(' b\n');
		expect(newestEntryCaret(editor)).toEqual({ path: [0], offset: 11 });
	});
});
