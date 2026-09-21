/**
 * @vitest-environment jsdom
 *
 * The KaTeX adapter, reached through the `@voithos-labs/aragonite/plugins/latex/renderer`
 * subpath. Anything that needs a real KaTeX render lives here; the caching layer above it is
 * proven in `math-renderer.test.ts`.
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

	// Invalid math shows as an error the user can see and act on, never KaTeX's bare
	// `.katex-error` run: the source itself, painted as an error, with the parser's message on
	// hover. latex-acceptance.spec.ts ties this to the live widget build in a browser.
	it('renders invalid math as its source marked as an error, with the message on hover (A5)', () => {
		const source = '\\frac{';
		const { dom, error } = katexRenderer(source, { display: false });

		expect(error).toBeTruthy();
		expect(dom.classList.contains('math-error')).toBe(true);
		expect(dom.textContent).toBe(source);
		expect(dom.title.toLowerCase()).toContain('error');
		expect(dom.querySelector('.katex-error')).toBeNull();
	});
});
