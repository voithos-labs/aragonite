// @vitest-environment jsdom
// What an editor running latex hands its renderer, and how often: once per form of a formula,
// never for dollars that aren't math, and not again for a key typed outside every formula.
// Miss-analysis: the cache rows called the renderings directly, so no row mounted an editor full
// of formulas and counted what its renderer drew.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { latex, type MathRenderer } from '#packages/latex/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	typeInFirstBlock
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

async function mounted(source: string) {
	const renderer = vi.fn<MathRenderer>(() => ({ dom: document.createElement('span') }));
	const editor = mountEditor({ source, plugins: [latex({ renderer })] });
	await editor.settle();
	const calls = () => renderer.mock.calls.map(([formula, { display }]) => [formula, display]);
	return { editor, renderer, calls };
}

describe('the renderer', () => {
	it('renders a formula the document repeats once inline and once displayed', async () => {
		const { editor, calls } = await mounted('see $x^2$ here\n\n$$x^2$$\n\n'.repeat(250));
		// The block list mounts a window of the 500 blocks; each form shows more than once in it.
		expect(editor.target.querySelectorAll('.math-inline-widget').length).toBeGreaterThan(1);
		expect(editor.target.querySelectorAll('.math-block-render').length).toBeGreaterThan(1);
		expect(calls()).toEqual([
			['x^2', false],
			['x^2', true]
		]);
	});

	it('renders fifty distinct formulas once each', async () => {
		const source = Array.from({ length: 50 }, (_, i) => `$x_{${i}}$`).join(' ');
		const { calls } = await mounted(`${source}\n`);
		expect(calls()).toEqual(Array.from({ length: 50 }, (_, i) => [`x_{${i}}`, false]));
	});

	it('draws nothing for dollars that open no formula', async () => {
		const { renderer } = await mounted('$HOME and $PATH\n\n'.repeat(200));
		expect(renderer).not.toHaveBeenCalled();
	});

	it('keeps a non-breaking space the formula pads with', async () => {
		const { calls } = await mounted('$$ x^2 $$\n');
		expect(calls()).toEqual([[' x^2', true]]);
	});

	it('draws no formula again for a key typed in a paragraph', async () => {
		const blocks = Array.from({ length: 40 }, (_, i) => `$$\nx_{${i}}\n$$`).join('\n\n');
		const { editor, renderer } = await mounted(`Lead\n\n${blocks}\n`);
		const mountIds = () =>
			[...editor.target.querySelectorAll<HTMLElement>('.math-block-render')].map(
				(el) => `${el.dataset.mountId}:${el.dataset.renderCount}`
			);
		const before = mountIds();
		const drawn = renderer.mock.calls.length;
		typeInFirstBlock(editor.target, 'Lead!');
		await editor.settle();
		expect(editor.source()).toMatch(/^Lead!\n/);
		expect(mountIds()).toEqual(before);
		expect(renderer.mock.calls.length).toBe(drawn);
	});
});
