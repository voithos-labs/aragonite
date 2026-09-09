/**
 * The engine adapter behind the `@voithos-labs/aragonite/plugins/latex/renderer` subpath. Importing
 * it is how a consumer opts into `katex`, an optional peer the engine-free core never
 * pulls.
 */

import katex from 'katex';
// Rides this module so a consumer wiring the adapter cannot forget it: `htmlAndMathml` emits
// a `.katex-mathml` a11y tree this CSS clips to 1px, and unloaded every equation paints twice.
import 'katex/dist/katex.min.css';
import type { MathRenderer } from './math-renderer';

/**
 * `throwOnError: false` keeps a malformed formula from crashing the editor; its fallback is
 * swapped for the source painted as an error — red, in the code face, the parser's message on
 * hover — so a broken formula reads as what the author typed, not as a sentence about it.
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
		return { dom: buildErrorNode(source, message), error: message };
	}
	return { dom: container };
};

function buildErrorNode(source: string, message: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'math-error';
	span.textContent = source;
	span.title = message;
	// Inline style rather than a stylesheet: the span lands inside any prose block, where no
	// plugin sheet is guaranteed to be mounted.
	span.style.color = 'var(--color-error, #d03025)';
	span.style.fontFamily = 'var(--font-code, ui-monospace, monospace)';
	span.style.fontSize = '0.9em';
	span.style.cursor = 'help';
	return span;
}
