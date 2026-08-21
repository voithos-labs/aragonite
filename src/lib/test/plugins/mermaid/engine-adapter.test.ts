/**
 * The engine adapter behind `@voithos-labs/aragonite/plugins/mermaid/renderer`. The engine is stubbed at
 * its module boundary because the adapter's `import('mermaid')` is its only seam, and the
 * real engine draws through SVG layout that no node run provides.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MermaidRenderContext } from '$lib/plugins/mermaid/mermaid-renderer';

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
/** Counts engine module evaluations, so a load at adapter-eval time is observable. */
const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock('mermaid', () => {
	loads.count++;
	return { default: engine };
});

// Mermaid's order is `render(id, text)`; deriving the svg from the second argument is
// what pins it, since a swapped call would draw the id.
const drawSvg = async (_id: string, code: string) => ({ svg: `<svg>${code}</svg>` });
const BASE_CONFIG = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true };
const settle = () => new Promise((resolve) => setTimeout(resolve));

// The subpath is published, so its callers need not be typed: the context is optional here.
type LooseRenderer = (code: string, id: string, context?: MermaidRenderContext) => Promise<string>;

/** The theme memo and the render queue are module-global, so each case starts cold. */
async function freshAdapter(): Promise<LooseRenderer> {
	vi.resetModules();
	return (await import('$lib/plugins/mermaid/renderer')).mermaidRenderer as LooseRenderer;
}

beforeEach(() => {
	engine.initialize.mockReset();
	engine.render.mockReset();
	engine.render.mockImplementation(drawSvg);
});

describe('mermaid engine adapter', () => {
	// Nothing may touch `document` until a diagram actually renders, so the engine has to
	// stay behind the dynamic import rather than ride the adapter's module eval.
	it('loads the engine on the first render, never at module eval', async () => {
		const before = loads.count;
		const render = await freshAdapter();
		expect(loads.count).toBe(before);

		await render('graph TD', 'id-a', { theme: 'dark' });
		expect(loads.count).toBe(before + 1);
	});

	// A fresh adapter per row: the theme memo would swallow a second row mapping to the
	// same mermaid theme, and the row would assert nothing.
	it('passes mermaid theme names through and falls back for anything else', async () => {
		const cases: [editorTheme: string | undefined, mermaidTheme: string][] = [
			['forest', 'forest'],
			['limestone-night', 'default'],
			[undefined, 'dark'] // an untyped caller omitting the context still picks a palette
		];
		for (const [editorTheme, mermaidTheme] of cases) {
			engine.initialize.mockClear();
			const render = await freshAdapter();
			await render(
				'graph TD',
				'id-a',
				editorTheme === undefined ? undefined : { theme: editorTheme }
			);
			expect(engine.initialize).toHaveBeenCalledTimes(1);
			expect(engine.initialize).toHaveBeenCalledWith(
				expect.objectContaining({ theme: mermaidTheme })
			);
		}
	});

	it('re-initializes only when the theme changes', async () => {
		const render = await freshAdapter();
		await render('a', 'id-1', { theme: 'dark' });
		await render('b', 'id-2', { theme: 'dark' });
		expect(engine.initialize).toHaveBeenCalledTimes(1);

		await render('c', 'id-3', { theme: 'forest' });
		expect(engine.initialize).toHaveBeenCalledTimes(2);

		// Back to the first theme: the site config says forest, so it has to be rewritten.
		await render('d', 'id-4', { theme: 'dark' });
		expect(engine.initialize).toHaveBeenCalledTimes(3);
	});

	// `initialize` replaces the site config rather than patching it, so a flip that sent
	// only `{ theme }` would drop suppressErrorRendering and the engine would inject its
	// own error SVG instead of rejecting.
	it('re-sends the whole base config on every initialize', async () => {
		const render = await freshAdapter();
		await render('a', 'id-1', { theme: 'dark' });
		await render('b', 'id-2', { theme: 'forest' });
		expect(engine.initialize.mock.calls).toEqual([
			[{ ...BASE_CONFIG, theme: 'dark' }],
			[{ ...BASE_CONFIG, theme: 'forest' }]
		]);
	});

	it('serializes renders, so no diagram straddles a theme flip', async () => {
		const render = await freshAdapter();
		let releaseFirst!: () => void;
		engine.render.mockImplementationOnce(async (_id: string, code: string) => {
			await new Promise<void>((resolve) => (releaseFirst = resolve));
			return { svg: `<svg>${code}</svg>` };
		});

		const first = render('A', 'id-a', { theme: 'dark' });
		const second = render('B', 'id-b', { theme: 'forest' });
		await settle();
		expect(engine.render).toHaveBeenCalledTimes(1);
		expect(engine.initialize).toHaveBeenCalledTimes(1);

		releaseFirst();
		expect(await first).toBe('<svg>A</svg>');
		expect(await second).toBe('<svg>B</svg>');
	});

	it('rejects a failed diagram without stranding the renders behind it', async () => {
		const render = await freshAdapter();
		engine.render.mockRejectedValueOnce(new Error('No diagram type detected'));

		await expect(render('nope', 'id-a', { theme: 'dark' })).rejects.toThrow(
			'No diagram type detected'
		);
		await expect(render('graph TD', 'id-b', { theme: 'dark' })).resolves.toBe(
			'<svg>graph TD</svg>'
		);
	});
});
