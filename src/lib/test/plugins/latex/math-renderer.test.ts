/**
 * @vitest-environment jsdom
 *
 * The math renderer slot as `latexPlugin` wires it: the display flag and theme reaching the
 * injected renderer, per-formula caching, and a throw painted as the formula's source. The KaTeX
 * adapter itself is proven in `renderer.test.ts`.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { installPlugins } from '#lib';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { mathSlot, type MathRenderer } from '#lib/plugins/latex/math-renderer.js';

const DARK = { theme: 'dark' };

function install(renderer: MathRenderer): void {
	installPlugins([latexPlugin({ renderer })]);
}

const echo = vi.fn<MathRenderer>((source, opts) => ({
	dom: Object.assign(document.createElement('span'), {
		textContent: `${source}:${opts.display}:${opts.theme}`
	})
}));

beforeEach(() => {
	echo.mockClear();
});

describe('the math renderer slot', () => {
	// The display flag is part of the cache key, so one formula at both sizes is two renders.
	it('hands the renderer its display flag and the theme', () => {
		install(echo);

		expect(mathSlot.render({ source: 'x^2', display: false }, DARK).dom.textContent).toBe(
			'x^2:false:dark'
		);
		expect(mathSlot.render({ source: 'x^2', display: true }, DARK).dom.textContent).toBe(
			'x^2:true:dark'
		);
		expect(echo).toHaveBeenNthCalledWith(1, 'x^2', { display: false, theme: 'dark' });
		expect(echo).toHaveBeenNthCalledWith(2, 'x^2', { display: true, theme: 'dark' });
	});

	it('renders a formula once and hands every caller its own node', () => {
		install(echo);

		const first = mathSlot.render({ source: 'x^2', display: false }, DARK);
		const second = mathSlot.render({ source: 'x^2', display: false }, DARK);

		expect(echo).toHaveBeenCalledTimes(1);
		// A live node can't sit in two places: repeats must clone, not alias the cache.
		expect(second.dom).not.toBe(first.dom);
		expect(second.dom.textContent).toBe('x^2:false:dark');
	});

	// The spy counts renders: a cache keyed on anything but the formula, or none, would render an
	// untouched equation again and fail the last assertion.
	it('re-renders only the edited equation; untouched ones stay cache hits (A2)', () => {
		install(echo);
		const render = (source: string) => mathSlot.render({ source, display: false }, DARK);

		for (const eq of ['a^2', 'b^2', 'c^2']) render(eq);
		expect(echo).toHaveBeenCalledTimes(3);

		render('a^3');
		expect(echo).toHaveBeenCalledTimes(4);

		for (const eq of ['b^2', 'c^2']) render(eq);
		expect(echo).toHaveBeenCalledTimes(4);
	});

	it('paints a throwing renderer as the formula source, marked as a math error', () => {
		install(() => {
			throw new Error('Undefined control sequence');
		});

		const { dom, error } = mathSlot.render({ source: '\\nope', display: false }, DARK);
		expect(error).toBe('Undefined control sequence');
		expect(dom.className).toBe('math-error');
		expect(dom.style.color).toContain('--color-error');
		expect(dom.textContent).toBe('\\nope');
		expect(dom.title).toBe('Undefined control sequence');
	});

	it('shows the source with no error color while no renderer is set', () => {
		installPlugins([latexPlugin()]);

		const { dom, error } = mathSlot.render({ source: 'x^2', display: false }, DARK);
		expect(error).toBeUndefined();
		expect(dom.className).toBe('');
		expect(dom.style.color).toBe('');
		expect(dom.textContent).toBe('x^2');
	});
});
