// @vitest-environment jsdom
// Miss-analysis: a `fencedBlock`'s `renderSource` was handed the whole text and its fence lines
// were the author's to draw, so a block with no painter showed undimmed fence lines no mode hid,
// and one with no `draw` dropped its painter; no row read the source a fenced block draws.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { VIEW_TEXT_ATTR } from '#lib/caret/block-content-selector.js';
import { definePlugin, fencedBlock, type TextDrawContext } from '#lib/plugin.js';
import type { FencedBlockSpec } from '#lib/schema/block-shapes.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const painted: string[] = [];
const bodySpan = (body: string) => {
	painted.push(body);
	const frag = document.createDocumentFragment();
	const span = frag.appendChild(document.createElement('span'));
	span.className = 'body';
	span.textContent = body;
	return frag;
};
const placed = (_block: unknown, ctx: TextDrawContext) => {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return { dom };
};

function fenced(spec: Partial<FencedBlockSpec>) {
	return definePlugin({
		name: 'fences',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				fencedBlock({
					name: 'demo',
					label: 'Demo',
					fence: { open: /^%%%$/, close: '%%%' },
					sample: '%%%\nx\n%%%',
					insert: { none: 'a test block type' },
					...spec
				} as FencedBlockSpec)
			]
		})
	});
}

async function mounted(source: string, spec: Partial<FencedBlockSpec>) {
	painted.length = 0;
	const editor = mountEditor({ source, plugins: [fenced(spec)] });
	await editor.settle();
	return editor;
}

/** The source's nodes as `[class, text]`, a text node's class empty. */
const shape = (el: HTMLElement): [string, string][] =>
	[...el.childNodes].map((node) => [
		node instanceof HTMLElement ? node.className : '',
		node.textContent ?? ''
	]);

const FENCE_LINE = 'md-fence-line';

describe('a fenced block’s fence lines', () => {
	it('are drawn by the editor around the body its renderSource paints', async () => {
		const editor = await mounted('%%%\nfirst\nsecond\n%%%\n', {
			edit: 'text',
			draw: placed,
			renderSource: bodySpan
		});
		const el = surfaceAt(editor, [0]);
		expect(el.textContent).toBe('%%%\nfirst\nsecond\n%%%');
		expect(shape(el)).toEqual([
			[FENCE_LINE, '%%%\n'],
			['body', 'first\nsecond'],
			[FENCE_LINE, '\n%%%']
		]);
		expect(el.querySelectorAll('.md-marker.md-fence')).toHaveLength(2);
		expect(painted).toContain('first\nsecond');
	});

	it('draw a code fence’s info string as the code block draws its own', async () => {
		const twin = await mounted('```demo\nx\n```\n', {
			fence: { info: 'demo' },
			edit: 'text',
			draw: placed
		});
		const code = mountEditor({ source: '```demo\nx\n```\n', plugins: [] });
		await code.settle();
		const html = (editor: MountedEditor, at: string) =>
			editor.target.querySelector<HTMLElement>(`[data-block-path="[0]"] ${at}`)!.innerHTML;
		expect(html(twin, `[${VIEW_TEXT_ATTR}]`)).toBe(html(code, '.code-block'));
	});

	it('are drawn for a block type with no draw, its renderSource painting the body', async () => {
		const editor = await mounted('%%%\nbody\n%%%\n', { renderSource: bodySpan });
		const el = surfaceAt(editor, [0]);
		expect(el.matches('.text-editable-block')).toBe(false);
		expect(shape(el)).toEqual([
			[FENCE_LINE, '%%%\n'],
			['body', 'body'],
			[FENCE_LINE, '\n%%%']
		]);
	});

	// The fence lines the editor painted are its own, not an element a drawing put in the text.
	it('stay in the text element through a redraw', async () => {
		let drawn = 0;
		const editor = await mounted('%%%\nbody\n%%%\n', {
			edit: 'text',
			draw: (block, ctx) => ({ ...placed(block, ctx), update: () => (drawn++, false) })
		});
		typeInto(surfaceAt(editor, [0]), '%%%\nbody!\n%%%');
		await editor.settle();
		expect(drawn).toBeGreaterThan(0);
		expect(takeDevWarnsOf('dom-view-content')).toEqual([]);
		expect(surfaceAt(editor, [0]).querySelectorAll(`.${FENCE_LINE}`)).toHaveLength(2);
	});

	it('draw a one-line block’s fences on its line', async () => {
		const editor = await mounted('$$x^2$$\n', {
			fence: { open: /\$\$/, close: '$$', oneLine: true },
			sample: '$$x^2$$',
			edit: 'text',
			draw: placed,
			renderSource: bodySpan
		});
		expect(shape(surfaceAt(editor, [0]))).toEqual([
			[FENCE_LINE, '$$'],
			['body', 'x^2'],
			[FENCE_LINE, '$$']
		]);
	});
});

describe('a fenced block’s shown text', () => {
	const opened = async (source: string, spec: Partial<FencedBlockSpec> = {}) => {
		const editor = await mounted(source, { draw: placed, ...spec } as Partial<FencedBlockSpec>);
		const seam = editor as MountedEditor<{
			getBlockComponent(path: number[]): {
				focus(at: number): void;
				getCursorOffset(): number;
			} | null;
		}>;
		seam.instance.__test.getBlockComponent([0])!.focus(0);
		await editor.settle();
		return {
			editor,
			el: surfaceAt(editor, [0]),
			caret: () => seam.instance.__test.getBlockComponent([0])!.getCursorOffset()
		};
	};

	it.each([
		['its fence lines alone', '%%%\n%%%\n', {}, '%%%\n\n%%%', 4],
		[
			'a one-line block with no text',
			'$$$$\n',
			{ fence: { open: /\$\$/, close: '$$', oneLine: true }, sample: '$$$$' },
			'$$\n\n$$',
			3
		]
	])('gains an empty body line on opening, for %s', async (_name, source, spec, shown, at) => {
		const { el, caret } = await opened(source, spec as Partial<FencedBlockSpec>);
		expect(el.textContent).toBe(shown);
		expect(caret()).toBe(at);
	});

	it('puts a one-line block’s fences on lines of their own once Enter goes into its text', async () => {
		const { editor, el, caret } = await opened('$$x^2$$\n', {
			fence: { open: /\$\$/, close: '$$', oneLine: true },
			sample: '$$x^2$$'
		});
		placeCaret(el, 4);
		await pressKey(el, { key: 'Enter' });
		expect(el.textContent).toBe('$$\nx^\n2\n$$');
		expect(caret()).toBe(6);
		expect(editor.source()).toBe('$$x^2$$\n');
	});
});
