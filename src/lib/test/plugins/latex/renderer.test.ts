/**
 * @vitest-environment jsdom
 *
 * The katex adapter — the engine half of the core/adapter split, reached through the
 * `@voithos-labs/aragonite/plugins/latex/renderer` subpath. Anything that needs a real katex render
 * lives here; the engine-free memo seam is proven in `math-renderer.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { katexRenderer } from '$lib/plugins/latex/renderer';

describe('katexRenderer', () => {
	it('renders valid math with MathML in the DOM (A9)', () => {
		const { dom, error } = katexRenderer('x^2', { display: false });

		expect(error).toBeUndefined();
		// KaTeX wraps its MathML in a `.katex-mathml` span; jsdom parses that class
		// reliably even where it drops the foreign-content <math> element itself.
		expect(dom.querySelector('.katex-mathml')).not.toBeNull();
	});

	// A5 — invalid math surfaces a legible inline message, never KaTeX's raw
	// `.katex-error` source strip. This adapter-level proof is A5's primary guard;
	// latex-acceptance.spec.ts ties it to the live widget-build path in a browser.
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
