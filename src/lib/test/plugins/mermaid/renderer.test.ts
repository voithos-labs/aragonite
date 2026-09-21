import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	setMermaidRenderer,
	hasMermaidRenderer,
	renderMermaid,
	MERMAID_MEMO_CAP
} from '$lib/plugins/mermaid/mermaid-renderer';

// The renderer is module-wide; leave it unset for the other files in this suite.
afterEach(() => setMermaidRenderer(null));

// One theme for the cases the theme is not about (caching, failure caching). Named rather
// than given a default: forgetting the theme on the one function whose point is that the
// theme is a render input must not compile.
const THEME = 'dark';

describe('renderMermaid memoization', () => {
	it('runs the renderer once per code text; a repeat is a cache hit', async () => {
		const renderer = vi.fn(async (code: string) => `<svg>${code}</svg>`);
		setMermaidRenderer(renderer);

		const first = await renderMermaid('graph TD', THEME);
		const second = await renderMermaid('graph TD', THEME);
		expect(renderer).toHaveBeenCalledTimes(1);
		expect(first.svg).toBe('<svg>graph TD</svg>');
		expect(second.svg).toBe(first.svg);

		await renderMermaid('graph LR', THEME);
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	// Mermaid paints its own colors into the SVG, so a diagram drawn for one theme cannot
	// be reused under another: the theme has to be part of the cache key, or a theme change
	// returns the cached wrong-palette SVG forever.
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

	// The key is built from two strings, so two (theme, code) pairs must not collide when
	// joined: with no separator, theme 'a' plus code 'b' would be the same entry as theme
	// 'ab' plus code ''.
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

		const first = await renderMermaid('nope', THEME);
		const second = await renderMermaid('nope', THEME);
		expect(first.error).toBe('No diagram type detected');
		expect(second.error).toBe('No diagram type detected');
		expect(renderer).toHaveBeenCalledTimes(1);
	});

	it('swapping the renderer clears the cache', async () => {
		setMermaidRenderer(async () => '<svg>one</svg>');
		expect((await renderMermaid('graph TD', THEME)).svg).toBe('<svg>one</svg>');

		setMermaidRenderer(async () => '<svg>two</svg>');
		expect((await renderMermaid('graph TD', THEME)).svg).toBe('<svg>two</svg>');
	});

	// The eviction rules are pinned generically in bounded-memo.test.ts; this proves
	// renderMermaid uses the real MERMAID_MEMO_CAP limit, so a long session evicts rather
	// than growing forever.
	it('evicts the least-recently-used entry past the cap', async () => {
		const renderer = vi.fn(async (code: string) => `<svg>${code}</svg>`);
		setMermaidRenderer(renderer);

		await renderMermaid('first', THEME);
		for (let i = 0; i < MERMAID_MEMO_CAP - 1; i++) await renderMermaid(`fill-${i}`, THEME);
		await renderMermaid('first', THEME); // hit — refreshed, still cached at exactly cap
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP);

		await renderMermaid('overflow', THEME); // past cap — evicts the LRU fill entry
		await renderMermaid('first', THEME); // survived on recency
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP + 1);

		await renderMermaid('fill-0', THEME); // evicted — renders again
		expect(renderer).toHaveBeenCalledTimes(MERMAID_MEMO_CAP + 2);
	});
});

describe('absent-renderer fallback', () => {
	// Pinned at this module because the component's static branch has no honest test level:
	// mounting MermaidBlock needs six contexts keyed by unexported symbols, and the harness
	// page installs the plugin with a renderer for the whole process.
	it('reports no renderer when unset and resolves to the configured-note error', async () => {
		expect(hasMermaidRenderer()).toBe(false);
		expect((await renderMermaid('graph TD', THEME)).error).toBe('renderer not configured');
	});
});
