// @vitest-environment jsdom
// Miss-analysis: a drawn `lineBlock`'s `renderSource` was handed its whole line, a fenced block's
// only its body, and no row read which of a line's bytes the editor draws as its marker.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { definePlugin, lineBlock, type TextDrawContext } from '#lib/plugin.js';
import type { LineBlockSpec } from '#lib/schema/block-shapes.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const painted: string[] = [];
const textSpan = (text: string) => {
	painted.push(text);
	const span = document.createElement('span');
	span.className = 'text';
	span.textContent = text;
	return span;
};
const placed = (_block: unknown, ctx: TextDrawContext) => {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return { dom };
};

async function mounted(source: string, spec: Partial<LineBlockSpec<never>>) {
	painted.length = 0;
	const plugin = definePlugin({
		name: 'lines',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				lineBlock({
					name: 'demo',
					label: 'Demo',
					match: /^\[(?<text>.*)\]$/,
					sample: '[x]',
					insert: { none: 'a test block type' },
					edit: 'text',
					draw: placed,
					...spec
				} as LineBlockSpec<never>)
			]
		})
	});
	const editor = mountEditor({ source, plugins: [plugin] });
	await editor.settle();
	return editor;
}

type Seam = { __test: { getBlockComponent(path: number[]): { focus(at: number): void } } };

/** The text element's nodes as `[class, text]`, a text node's class empty. */
const shape = (el: HTMLElement): [string, string][] =>
	[...el.childNodes].map((node) => [
		node instanceof HTMLElement ? node.className : '',
		node.textContent ?? ''
	]);

describe('a drawn line block’s marker', () => {
	it('is drawn by the editor on each side of the text its renderSource paints', async () => {
		const editor = await mounted('[abc]\n', { renderSource: textSpan });
		expect(shape(surfaceAt(editor, [0]))).toEqual([
			['md-marker', '['],
			['text', 'abc'],
			['md-marker', ']']
		]);
		expect(painted).toContain('abc');
	});

	it('is the whole line for a line with no text of its own', async () => {
		const editor = await mounted('[[toc]]\n', { match: /^\[\[toc\]\]$/, sample: '[[toc]]' });
		expect(shape(surfaceAt(editor, [0]))).toEqual([
			['md-marker', '[[toc]]'],
			['', '']
		]);
	});

	it('is no marker once typing makes the line one the type does not read', async () => {
		const editor = await mounted('[abc]\n', { edit: 'source', renderSource: textSpan });
		(editor.instance as unknown as Seam).__test.getBlockComponent([0]).focus(1);
		await editor.settle();
		typeInto(surfaceAt(editor, [0]), '[abc');
		await editor.settle();
		expect(shape(surfaceAt(editor, [0]))).toEqual([['text', '[abc']]);
	});
});

describe('the bundled parrot’s open source', () => {
	it('draws its marker dimmed before its caption', async () => {
		const editor = mountEditor({ source: '%%parrot party on\n', plugins: [parrotPlugin()] });
		await editor.settle();
		(editor.instance as unknown as Seam).__test.getBlockComponent([0]).focus(9);
		await editor.settle();
		const source = editor.target.querySelector<HTMLElement>('.parrot-source')!;
		expect(shape(source)).toEqual([
			['md-marker', '%%parrot '],
			['', 'party on']
		]);
	});
});
