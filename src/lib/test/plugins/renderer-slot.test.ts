/**
 * @vitest-environment jsdom
 *
 * The renderer slot behind every injected renderer: the theme joined into its cache key, the
 * missing and failed outputs, and the platform reset dropping the renderer.
 */
import { describe, it, expect, vi } from 'vitest';
import {
	createAsyncRendererSlot,
	createRendererSlot,
	renderSourceFallback,
	type RenderContext
} from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';

const DARK: RenderContext = { theme: 'dark' };
const LIGHT: RenderContext = { theme: 'light' };

const textSlot = (cap?: number) =>
	createRendererSlot<string, string>({
		key: (source) => source,
		missing: (source) => `missing:${source}`,
		failed: (source, error) => `failed:${source}:${(error as Error).message}`,
		cap
	});

describe('createRendererSlot', () => {
	it('hands the renderer the theme and caches per theme, so a switch back is a hit', () => {
		const slot = textSlot();
		const renderer = vi.fn((source: string, ctx: RenderContext) => `${ctx.theme}:${source}`);
		slot.set(renderer);

		expect(slot.render('x', DARK)).toBe('dark:x');
		expect(slot.render('x', DARK)).toBe('dark:x');
		expect(renderer).toHaveBeenCalledTimes(1);

		expect(slot.render('x', LIGHT)).toBe('light:x');
		expect(renderer).toHaveBeenCalledTimes(2);

		expect(slot.render('x', DARK)).toBe('dark:x');
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	// A theme and a key are joined into one string, so theme 'a' with key 'b' must not share an
	// entry with theme 'ab' and key ''.
	it('keeps two theme and key pairs that concatenate alike apart', () => {
		const slot = textSlot();
		const renderer = vi.fn((source: string, ctx: RenderContext) => `${ctx.theme}|${source}`);
		slot.set(renderer);

		expect(slot.render('b', { theme: 'a' })).toBe('a|b');
		expect(slot.render('', { theme: 'ab' })).toBe('ab|');
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	it('returns the missing output while no renderer is set, and reports it unconfigured', () => {
		const slot = textSlot();
		expect(slot.configured).toBe(false);
		expect(slot.render('x', DARK)).toBe('missing:x');

		slot.set(() => 'drawn');
		expect(slot.configured).toBe(true);
		expect(slot.render('x', DARK)).toBe('drawn');
	});

	it('turns a throw into the failed output and caches it like a success', () => {
		const slot = textSlot();
		const renderer = vi.fn((): string => {
			throw new Error('bad input');
		});
		slot.set(renderer);

		expect(slot.render('x', DARK)).toBe('failed:x:bad input');
		expect(slot.render('x', DARK)).toBe('failed:x:bad input');
		expect(renderer).toHaveBeenCalledTimes(1);
	});

	it('empties the cache when the renderer is replaced', () => {
		const slot = textSlot();
		slot.set(() => 'one');
		expect(slot.render('x', DARK)).toBe('one');

		slot.set(() => 'two');
		expect(slot.render('x', DARK)).toBe('two');
	});

	it('evicts the least recently used render past its cap', () => {
		const slot = textSlot(2);
		const renderer = vi.fn((source: string) => source);
		slot.set(renderer);

		slot.render('a', DARK);
		slot.render('b', DARK);
		slot.render('a', DARK);
		slot.render('c', DARK);
		expect(renderer).toHaveBeenCalledTimes(3);

		slot.render('a', DARK);
		expect(renderer).toHaveBeenCalledTimes(3);
		slot.render('b', DARK);
		expect(renderer).toHaveBeenCalledTimes(4);
	});

	// A cached DOM node can sit in only one place, so each read of it has to be its own copy.
	it('hands every caller its own copy through cloneOnRead', () => {
		const slot = createRendererSlot<string, HTMLElement>({
			key: (source) => source,
			missing: () => document.createElement('span'),
			failed: () => document.createElement('span'),
			cloneOnRead: (el) => el.cloneNode(true) as HTMLElement
		});
		slot.set((source) => Object.assign(document.createElement('span'), { textContent: source }));

		const first = slot.render('x', DARK);
		const second = slot.render('x', DARK);
		expect(second).not.toBe(first);
		expect(second.textContent).toBe('x');
	});

	it('drops the renderer and its cache on the platform test reset', () => {
		const slot = textSlot();
		slot.set(() => 'drawn');
		expect(slot.render('x', DARK)).toBe('drawn');

		resetPluginPlatformForTests();
		expect(slot.configured).toBe(false);
		expect(slot.render('x', DARK)).toBe('missing:x');
	});
});

describe('createAsyncRendererSlot', () => {
	const asyncSlot = () =>
		createAsyncRendererSlot<string, string>({
			key: (source) => source,
			missing: (source) => `missing:${source}`,
			failed: (source, error) => `failed:${source}:${(error as Error).message}`
		});

	it('shares one call between two renders in flight, per theme', async () => {
		const slot = asyncSlot();
		const renderer = vi.fn(async (source: string, ctx: RenderContext) => `${ctx.theme}:${source}`);
		slot.set(renderer);

		const [a, b] = await Promise.all([slot.render('x', DARK), slot.render('x', DARK)]);
		expect([a, b]).toEqual(['dark:x', 'dark:x']);
		expect(renderer).toHaveBeenCalledTimes(1);

		expect(await slot.render('x', LIGHT)).toBe('light:x');
		expect(await slot.render('x', DARK)).toBe('dark:x');
		expect(renderer).toHaveBeenCalledTimes(2);
	});

	it('resolves a rejection and a synchronous throw through the failed output, cached', async () => {
		const slot = asyncSlot();
		const rejecting = vi.fn(async (): Promise<string> => {
			throw new Error('no diagram type');
		});
		slot.set(rejecting);
		expect(await slot.render('x', DARK)).toBe('failed:x:no diagram type');
		expect(await slot.render('x', DARK)).toBe('failed:x:no diagram type');
		expect(rejecting).toHaveBeenCalledTimes(1);

		slot.set((): Promise<string> => {
			throw new Error('threw early');
		});
		expect(await slot.render('x', DARK)).toBe('failed:x:threw early');
	});

	it('resolves to the missing output with no renderer, and drops it on the test reset', async () => {
		const slot = asyncSlot();
		expect(await slot.render('x', DARK)).toBe('missing:x');

		slot.set(async () => 'drawn');
		expect(slot.configured).toBe(true);
		resetPluginPlatformForTests();
		expect(slot.configured).toBe(false);
		expect(await slot.render('x', DARK)).toBe('missing:x');
	});
});

describe('renderSourceFallback', () => {
	it('shows the source itself, with the message on hover rather than beside it', () => {
		const el = renderSourceFallback('\\frac{', 'Expected group after \\frac');
		expect(el.textContent).toBe('\\frac{');
		expect(el.title).toBe('Expected group after \\frac');
	});
});
