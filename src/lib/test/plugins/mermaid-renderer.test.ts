import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	setMermaidRenderer,
	hasMermaidRenderer,
	renderMermaid
} from '../../../routes/test/plugins/mermaid/mermaid-renderer';

// The renderer is module-global; leave it unset for the suite's other files.
afterEach(() => setMermaidRenderer(null));

describe('renderMermaid memoization', () => {
	it('runs the renderer once per code text; a repeat is a cache hit', async () => {
		const renderer = vi.fn(async (code: string) => `<svg>${code}</svg>`);
		setMermaidRenderer(renderer);

		const first = await renderMermaid('graph TD');
		const second = await renderMermaid('graph TD');
		expect(renderer).toHaveBeenCalledTimes(1);
		expect(first.svg).toBe('<svg>graph TD</svg>');
		expect(second.svg).toBe(first.svg);

		await renderMermaid('graph LR');
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	it('resolves a renderer failure to a legible error and caches it like a success', async () => {
		const renderer = vi.fn(async () => {
			throw new Error('No diagram type detected');
		});
		setMermaidRenderer(renderer);

		const first = await renderMermaid('nope');
		const second = await renderMermaid('nope');
		expect(first.error).toBe('No diagram type detected');
		expect(second.error).toBe('No diagram type detected');
		expect(renderer).toHaveBeenCalledTimes(1);
	});

	it('swapping the renderer clears the cache', async () => {
		setMermaidRenderer(async () => '<svg>one</svg>');
		expect((await renderMermaid('graph TD')).svg).toBe('<svg>one</svg>');

		setMermaidRenderer(async () => '<svg>two</svg>');
		expect((await renderMermaid('graph TD')).svg).toBe('<svg>two</svg>');
	});
});

describe('absent-renderer fallback', () => {
	// The component's static branch (code shown verbatim + the "renderer not
	// configured" note) keys on this module seam. The branch's markup itself has
	// no honest test level: mounting MermaidBlock needs six editor contexts keyed
	// by unexported symbols, and the harness page installs the plugin
	// renderer-equipped process-wide. So the seam is the pin.
	it('reports no renderer when unset and resolves to the configured-note error', async () => {
		expect(hasMermaidRenderer()).toBe(false);
		expect((await renderMermaid('graph TD')).error).toBe('renderer not configured');
	});
});
