// @vitest-environment jsdom
// A paste reads where it goes as its event arrives, before a shown source hides: it replaces the
// range the user selected, and undo puts the caret back where the paste began, on every surface.
// Miss-analysis: the paste tails read the selection after the hide's await, and every paste test
// selected outside a shown source, where the hide moves nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchKey } from '#lib/test/harness/settle.js';
import { newestEntryCaret } from '../support/undo-entry';
import { definePluginBlock, registerBlockOpener } from '#lib/plugin.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import PlainLeafBlock from '../plugins/fixtures/PlainLeafBlock.svelte';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import type { MathRenderer } from '#lib/plugins/latex/math-renderer.js';
import type { EditorTestSurface } from '#lib/components/editor-root-test-surface.js';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

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

function paste(target: EventTarget, text: string): void {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [], items: [] }
	});
	target.dispatchEvent(e);
}

const cell = (editor: Editor, index: number) =>
	editor.target.querySelectorAll<HTMLElement>('.table-cell')[index];

/** Edits the shown inline `$x$` source in the DOM, as typing into it does. */
async function editShownSource(editor: Editor, surface: HTMLElement, edited: string) {
	const source = Array.from(surface.childNodes).find(
		(c): c is Text => c.nodeType === Node.TEXT_NODE && c.textContent?.includes('$x$') === true
	);
	expect(source, 'the widget source is not showing').toBeDefined();
	source!.textContent = source!.textContent!.replace('$x$', edited);
	await editor.settle();
}

const SHOWN: {
	name: string;
	source: string;
	/** Shows the source and returns the surface holding it. */
	show(editor: Editor): Promise<HTMLElement>;
	from: number;
	left: string;
}[] = [
	{
		name: 'a paragraph',
		source: '$x$ b\n',
		async show(editor) {
			editor.instance.__test.getBlockComponent([0])?.enterEdgeWidget?.('start');
			await editor.settle();
			return surfaceAt(editor, [0]);
		},
		from: 2,
		left: '$xZ$ b\n'
	},
	{
		name: 'a table cell',
		source: '| h |\n| --- |\n| a $x$ |\n',
		async show(editor) {
			const el = cell(editor, 1);
			placeCaret(el, 5);
			dispatchKey(el, { key: 'ArrowLeft' });
			await editor.settle();
			return el;
		},
		from: 4,
		left: '| h |\n| --- |\n| a $xZ$ |\n'
	}
];

describe.each(['live', 'source'] as const)(
	'%s mode: a paste over a range inside a shown inline source',
	(mode) => {
		for (const { name, source, show, from, left } of SHOWN) {
			it(`replaces that range, in ${name}`, async () => {
				const editor: Editor = mountEditor({
					source,
					presentationMode: mode,
					plugins: [latexPlugin({ renderer: stubRenderer })]
				});
				await editor.settle();
				const el = await show(editor);
				await editShownSource(editor, el, '$xyz$');
				selectRange(el, from, from + 2);

				paste(el, 'Z');
				await editor.settle();

				expect(editor.source()).toBe(left);
			});
		}
	}
);

/** A plain-mode editable leaf whose block is one `@@ ` line; it commits each edit as it lands. */
const plainLeaf = definePluginBlock({
	name: 'paste-plain-leaf',
	kind: 'paste-plain-leaf',
	component: PlainLeafBlock,
	register: () => {
		const kind = testLeaf('paste-plain-leaf');
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

// A menu's Paste fires no key, so the caret the last key recorded must not stand in for the paste's.
describe('a paste’s undo caret is where it began, after a key at another caret', () => {
	const SURFACES: {
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
	for (const { name, source, surface, path, at } of SURFACES) {
		it.each(['a caret', 'a range'] as const)(`${name}, at %s`, async (shape) => {
			const editor: Editor = mountEditor({ source, plugins: [plainLeaf] });
			await editor.settle();
			const el = surface(editor);
			placeCaret(el, at + 2);
			dispatchKey(el, { key: 'Shift' });
			if (shape === 'a range') selectRange(el, at, at + 2);
			else placeCaret(el, at);

			paste(el, 'Z');
			await editor.settle();

			expect(newestEntryCaret(editor)).toEqual({ path, offset: at });
		});
	}
});
