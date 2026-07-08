/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import {
	katexRenderer,
	createMemoizedRenderer
} from '../../../routes/test/plugins/latex/math-renderer';

describe('createMemoizedRenderer', () => {
	it('runs inner once per (source, display) and hands back a fresh node each call', () => {
		const inner = vi.fn((source: string, _opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = source;
			return { dom };
		});
		const render = createMemoizedRenderer(inner);

		const first = render('x^2', { display: false });
		const second = render('x^2', { display: false });

		expect(inner).toHaveBeenCalledTimes(1);
		// A live node can't sit in two places: repeats must clone, not alias the cache.
		expect(second.dom).not.toBe(first.dom);
		expect(first.dom.textContent).toBe('x^2');
		expect(second.dom.textContent).toBe('x^2');
	});

	it('keys on display: the same source in display mode is a distinct entry', () => {
		const inner = vi.fn((source: string, opts: { display: boolean }) => {
			const dom = document.createElement('span');
			dom.textContent = `${source}:${opts.display}`;
			return { dom };
		});
		const render = createMemoizedRenderer(inner);

		render('x^2', { display: false });
		render('x^2', { display: true });

		expect(inner).toHaveBeenCalledTimes(2);
	});
});

describe('katexRenderer', () => {
	it('renders valid math with MathML in the DOM (A9)', () => {
		const { dom, error } = katexRenderer('x^2', { display: false });

		expect(error).toBeUndefined();
		// KaTeX wraps its MathML in a `.katex-mathml` span; jsdom parses that class
		// reliably even where it drops the foreign-content <math> element itself.
		expect(dom.querySelector('.katex-mathml')).not.toBeNull();
	});

	it('renders invalid math as a legible error node, never the raw source (A5)', () => {
		const source = '\\frac{';
		const { dom, error } = katexRenderer(source, { display: false });

		expect(error).toBeTruthy();
		const text = dom.textContent ?? '';
		// KaTeX's throwOnError:false emits a strip whose text IS the raw source;
		// the adapter must replace it with a human message.
		expect(text).not.toBe(source);
		expect(text.toLowerCase()).toContain('error');
	});
});
