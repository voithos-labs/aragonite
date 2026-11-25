// One editor's renderings as the plugin wires them: the theme and a fresh element id reaching the
// injected renderer, the SVG wrapped as a result, a rejection or no renderer as an error, and a
// second editor keeping its own.
import { describe, it, expect, vi } from 'vitest';
import { mermaidRenders } from '#packages/mermaid/src/mermaid-renderer.js';
import type { MermaidRenderer } from '#packages/mermaid/src/index.js';

describe("one editor's diagram renderings", () => {
	it('draws for the theme, once per theme, with a fresh element id per render', async () => {
		const renderer = vi.fn<MermaidRenderer>(
			async (code, _id, { theme }) => `<svg data-theme="${theme}">${code}</svg>`
		);
		const renders = mermaidRenders(renderer);

		const dark = await renders.render('graph TD', 'dark');
		expect(dark).toEqual({ svg: '<svg data-theme="dark">graph TD</svg>' });
		expect(await renders.render('graph TD', 'dark')).toBe(dark);
		expect(await renders.render('graph TD', 'light')).toEqual({
			svg: '<svg data-theme="light">graph TD</svg>'
		});
		expect(renderer).toHaveBeenCalledTimes(2);

		// A second diagram under the same theme is its own render, never the first one's SVG.
		expect(await renders.render('graph LR', 'dark')).toEqual({
			svg: '<svg data-theme="dark">graph LR</svg>'
		});
		const ids = renderer.mock.calls.map(([, id]) => id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => id.startsWith('aragonite-mermaid-'))).toBe(true);
	});

	it('resolves a rejection to its message, cached like a success', async () => {
		const renderer = vi.fn<MermaidRenderer>(async () => {
			throw new Error('Parse error on line 1');
		});
		const renders = mermaidRenders(renderer);

		expect(await renders.render('notadiagram', 'light')).toEqual({
			error: 'Parse error on line 1'
		});
		await renders.render('notadiagram', 'light');
		expect(renderer).toHaveBeenCalledTimes(1);
	});

	it('reports no renderer, and resolves to the not-configured error', async () => {
		const renders = mermaidRenders(undefined);
		expect(renders.configured).toBe(false);
		expect(await renders.render('graph TD', 'light')).toEqual({
			error: 'renderer not configured'
		});
	});

	it('keeps each editor’s renderings apart', async () => {
		const one = vi.fn<MermaidRenderer>(async () => '<svg>one</svg>');
		const two = vi.fn<MermaidRenderer>(async () => '<svg>two</svg>');
		expect(await mermaidRenders(one).render('graph TD', 'light')).toEqual({
			svg: '<svg>one</svg>'
		});
		expect(await mermaidRenders(two).render('graph TD', 'light')).toEqual({
			svg: '<svg>two</svg>'
		});
	});
});
