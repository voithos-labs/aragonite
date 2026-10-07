// @vitest-environment jsdom
// A write to a block's own text keeps the block's own line ending, so a document saved without
// a final line break keeps none, whichever editable element and route wrote the last block.
// Miss-analysis: GH #616, the typing fixtures all ended in a line break, the one that did not
// pinned the document's ending, and the writes not yet on `writeText` had no row at all.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	selectRange,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '../harness/mount-editor.svelte';
import { pressKey, settleEditor } from '../harness/settle';
import { mountBlock } from '../harness/mount-block';
import { leafDocument, registerRevealLeafKind } from './fixtures/reveal-leaf';
import PlainOneLineLeafBlock from './fixtures/PlainOneLineLeafBlock.svelte';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';
import type { EditorProps } from '$lib/editor-props';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

beforeAll(() => {
	installLayoutStubs();
	// Showing a widget's source measures the caret through Range rects, which jsdom lacks.
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

describe('a keystroke on the unterminated last block', () => {
	it.each([
		['a paragraph', 'a\n\nlast', 'lastZ', 'a\n\nlastZ'],
		['a heading', 'a\n\n# last', '# lastZ', 'a\n\n# lastZ'],
		['a CRLF paragraph', 'a\r\n\r\nlast', 'lastZ', 'a\r\n\r\nlastZ'],
		['a code block', 'a\n\n```\nx\n```', '```\nxZ\n```', 'a\n\n```\nxZ\n```']
	])('in %s keeps it unterminated', async (_, source, typed, expected) => {
		const editor = mountEditor({ source });
		typeInto(surfaceAt(editor, [1]), typed);
		await editor.settle();
		expect(editor.source()).toBe(expected);
	});

	it('in a plugin leaf keeps it unterminated', async () => {
		const kind = registerRevealLeafKind('unterminated-leaf');
		const leaf = mountBlock(PlainOneLineLeafBlock, { doc: leafDocument(kind, '@@ one') });
		const el = leaf.target.querySelector<HTMLElement>('.plain-one-line-source')!;

		typeInto(el, '@@ oneZ');
		await settleEditor();

		expect(leaf.blockEdit.updateBlockContent.mock.calls.map((call) => call[1])).toEqual([
			'@@ oneZ'
		]);
		await leaf.dispose();
	});
});

type Seam = {
	getBlockComponent(path: number[]): {
		focus?(offset: number): void;
		enterEdgeWidget?(side: 'start'): boolean;
	};
};

interface OwnTextRoute {
	props: EditorProps;
	drive(editor: MountedEditor<Seam>): Promise<void>;
	expected: string;
}

const withMath = (props: EditorProps): EditorProps => ({
	...props,
	plugins: [latexPlugin({ renderer: stubRenderer })]
});

// Each route writes the block's own text without going through the typed-input write.
const ROUTES: Array<[string, OwnTextRoute]> = [
	[
		'the format toggle (Ctrl+B)',
		{
			props: { source: 'a\n\nlast' },
			drive: async (editor) => {
				const surface = surfaceAt(editor, [1]);
				selectRange(surface, 0, 4);
				await pressKey(surface, { key: 'b', ctrlKey: true });
			},
			expected: 'a\n\n**last**'
		}
	],
	[
		"the code block's Enter",
		{
			props: { source: 'a\n\n```\nx\n```' },
			drive: async (editor) => {
				await pressKeyAt(editor, [1], 5, { key: 'Enter' });
			},
			expected: 'a\n\n```\nx\n\n```'
		}
	],
	[
		"a plugin leaf's source, on blur",
		{
			props: withMath({ source: 'a\n\n$$\nold\n$$' }),
			drive: async (editor) => {
				editor.instance.__test.getBlockComponent([1]).focus?.(3);
				await editor.settle();
				const source = editor.target.querySelector<HTMLElement>('.math-block-source');
				expect(source, 'the math source is not showing').not.toBeNull();
				source!.textContent = '$$\nnew\n$$';
				source!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
			},
			expected: 'a\n\n$$\nnew\n$$'
		}
	],
	[
		"an inline widget's source, on blur",
		{
			props: withMath({ source: 'a\n\n$x$', presentationMode: 'live' }),
			drive: async (editor) => {
				editor.instance.__test.getBlockComponent([1]).enterEdgeWidget?.('start');
				await editor.settle();
				const surface = surfaceAt(editor, [1]);
				const shown = Array.from(surface.childNodes).find(
					(c): c is Text => c.nodeType === Node.TEXT_NODE && c.textContent?.includes('$x$') === true
				);
				expect(shown, 'the widget source is not showing').toBeDefined();
				shown!.textContent = shown!.textContent!.replace('$x$', '$y$');
				await editor.settle();
				surface.dispatchEvent(new FocusEvent('blur'));
			},
			expected: 'a\n\n$y$'
		}
	]
];

describe('an own-text write on the unterminated last block', () => {
	it.each(ROUTES)('through %s keeps it unterminated', async (_, route) => {
		const editor = mountEditor<Seam>(route.props);
		await editor.settle();

		await route.drive(editor);
		await editor.settle();

		expect(editor.source()).toBe(route.expected);
	});
});
