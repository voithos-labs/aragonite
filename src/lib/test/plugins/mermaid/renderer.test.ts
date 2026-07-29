import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	setMermaidRenderer,
	hasMermaidRenderer,
	renderMermaid,
	MERMAID_MEMO_CAP
} from '$lib/plugins/mermaid/mermaid-renderer';

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

	// The engine paints its own colors into the SVG, so a diagram already drawn for
	// one theme is not reusable under another: the theme has to be part of the memo
	// key, or a theme flip resolves to the cached wrong-palette SVG forever.
	it('keys on the theme as well as the code, and hands the renderer the theme', async () => {
		const renderer = vi.fn(async (code: string, _id: string, ctx?: { theme: string }) => {
			return `<svg data-theme="${ctx?.theme}">${code}</svg>`;
		});
		setMermaidRenderer(renderer);

		const dark = await renderMermaid('graph TD', 'dark');
		expect(dark.svg).toBe('<svg data-theme="dark">graph TD</svg>');
		expect(await renderMermaid('graph TD', 'dark')).toBe(dark);
		expect(renderer).toHaveBeenCalledTimes(1);

		const light = await renderMermaid('graph TD', 'light');
		expect(light.svg).toBe('<svg data-theme="light">graph TD</svg>');
		expect(renderer).toHaveBeenCalledTimes(2);

		// Back to the first theme: the earlier render is still cached under its key.
		await renderMermaid('graph TD', 'dark');
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	// The key is composed, so two (theme, code) pairs must not be able to collide by
	// concatenation — a separator-less key would make theme 'a' + code 'b' the same
	// entry as theme 'ab' + code ''.
	it('cannot collide two theme/code pairs into one entry', async () => {
		const renderer = vi.fn(async (code: string) => `<svg>${code}</svg>`);
		setMermaidRenderer(renderer);

		await renderMermaid('b', 'a');
		await renderMermaid('', 'ab');
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

	// The LRU mechanics are pinned generically in bounded-memo.test.ts; this proves
	// renderMermaid wires the real MERMAID_MEMO_CAP bound, so churn evicts rather
	// than grows forever.
	it('evicts the least-recently-used entry past the cap', async () => {
		const renderer = vi.fn(async (code: string) => `<svg>${code}</svg>`);
		setMermaidRenderer(renderer);

		await renderMermaid('first');
		for (let i = 0; i < MERMAID_MEMO_CAP - 1; i++) await renderMermaid(`fill-${i}`);
		await renderMermaid('first'); // hit — refreshed, still cached at exactly cap
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP);

		await renderMermaid('overflow'); // past cap — evicts the LRU fill entry
		await renderMermaid('first'); // survived on recency
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP + 1);

		await renderMermaid('fill-0'); // evicted — renders again
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP + 2);
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
