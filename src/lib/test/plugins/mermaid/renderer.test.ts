// The mermaid renderer slot as `mermaidPlugin` wires it: the theme and a fresh element id reaching
// the injected renderer, the SVG wrapped as a result, and a rejection or no renderer as an error.
import { describe, it, expect, vi } from 'vitest';
import { installPlugins } from '#lib';
import { mermaidPlugin } from '#lib/plugins/mermaid/index.js';
import { mermaidSlot, type MermaidRenderer } from '#lib/plugins/mermaid/mermaid-renderer.js';

function install(renderer?: MermaidRenderer): void {
	installPlugins([mermaidPlugin({ renderer })]);
}

describe('the mermaid renderer slot', () => {
	it('draws for the theme, once per theme, with a fresh element id per render', async () => {
		const renderer = vi.fn<MermaidRenderer>(
			async (code, _id, { theme }) => `<svg data-theme="${theme}">${code}</svg>`
		);
		install(renderer);

		const dark = await mermaidSlot.render('graph TD', { theme: 'dark' });
		expect(dark).toEqual({ svg: '<svg data-theme="dark">graph TD</svg>' });
		expect(await mermaidSlot.render('graph TD', { theme: 'dark' })).toBe(dark);
		expect(await mermaidSlot.render('graph TD', { theme: 'light' })).toEqual({
			svg: '<svg data-theme="light">graph TD</svg>'
		});
		expect(renderer).toHaveBeenCalledTimes(2);

		// A second diagram under the same theme is its own render, never the first one's SVG.
		expect(await mermaidSlot.render('graph LR', { theme: 'dark' })).toEqual({
			svg: '<svg data-theme="dark">graph LR</svg>'
		});
		expect(renderer).toHaveBeenCalledTimes(3);

		// Mermaid renders into a DOM element by id, so two renders sharing one would collide.
		const [first, second] = renderer.mock.calls.map(([, id]) => id);
		expect(first).not.toBe(second);
	});

	it('resolves a rejection to its message, cached like a success', async () => {
		const renderer = vi.fn<MermaidRenderer>(async () => {
			throw new Error('No diagram type detected');
		});
		install(renderer);

		const first = await mermaidSlot.render('nope', { theme: 'dark' });
		const second = await mermaidSlot.render('nope', { theme: 'dark' });
		expect([first, second]).toEqual([
			{ error: 'No diagram type detected' },
			{ error: 'No diagram type detected' }
		]);
		expect(renderer).toHaveBeenCalledTimes(1);
	});

	it('reports no renderer on a bare install, and resolves to the not-configured error', async () => {
		install();
		expect(mermaidSlot.configured).toBe(false);
		expect(await mermaidSlot.render('graph TD', { theme: 'dark' })).toEqual({
			error: 'renderer not configured'
		});
	});
});
