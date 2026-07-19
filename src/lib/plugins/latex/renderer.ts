/**
 * KaTeX-backed math renderer — the engine adapter reached through the
 * `aragonite/plugins/latex/renderer` subpath. Importing this pulls `katex` (an
 * optional peer) and its stylesheet; the plugin's engine-free core never does, so
 * a consumer opts into the dependency by importing this and passing the export as
 * `latexPlugin({ renderer: katexRenderer })`.
 */

import katex from 'katex';
// The stylesheet is the engine's dependency: `htmlAndMathml` emits a `.katex-mathml`
// a11y tree this CSS clips to a 1px box — unloaded, every equation paints twice (the
// render plus the TeX echoed as text). It rides this module so a consumer wiring the
// adapter can't forget it; the package's `sideEffects` listing keeps a bundler from
// dropping the bare import.
import 'katex/dist/katex.min.css';
import type { MathRenderer } from './math-renderer';

/**
 * `throwOnError: false` keeps a malformed formula from crashing the editor, but
 * KaTeX's fallback renders the source verbatim in `errorColor` — a bare raw-source
 * strip (A5 forbids that). We keep the flag, then detect KaTeX's documented
 * `.katex-error` span and swap in a legible message, surfacing the `title`
 * diagnostic as the `error` string.
 */
export const katexRenderer: MathRenderer = (source, { display }) => {
	const container = document.createElement('span');
	container.innerHTML = katex.renderToString(source, {
		throwOnError: false,
		displayMode: display,
		output: 'htmlAndMathml'
	});

	const errorSpan = container.querySelector('.katex-error');
	if (errorSpan) {
		const message = (errorSpan.getAttribute('title') ?? 'invalid LaTeX').replace(
			/^ParseError:\s*/,
			''
		);
		return { dom: buildErrorNode(message), error: message };
	}
	return { dom: container };
};

function buildErrorNode(message: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'math-error';
	span.textContent = `Math error: ${message}`;
	return span;
}
