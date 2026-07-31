/**
 * The engine adapter behind the `aragonite/plugins/latex/renderer` subpath. Importing
 * it is how a consumer opts into `katex`, an optional peer the engine-free core never
 * pulls.
 */

import katex from 'katex';
// Rides this module so a consumer wiring the adapter cannot forget it: `htmlAndMathml`
// emits a `.katex-mathml` a11y tree this CSS clips to 1px, and unloaded every equation
// paints twice. The package's `sideEffects` listing keeps a bundler from dropping it.
import 'katex/dist/katex.min.css';
import type { MathRenderer } from './math-renderer';

/**
 * `throwOnError: false` keeps a malformed formula from crashing the editor, but its
 * fallback renders the source verbatim, a bare raw-source strip that A5 forbids —
 * hence detecting `.katex-error` and swapping in a legible message.
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
