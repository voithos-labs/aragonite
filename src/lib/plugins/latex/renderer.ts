/**
 * The KaTeX adapter behind the `@voithos-labs/aragonite/plugins/latex/renderer` subpath.
 * Importing it is how a consumer opts into `katex`, an optional peer dependency nothing else
 * pulls in.
 */

import katex from 'katex';
// Imported here so a consumer wiring the adapter cannot forget it: `htmlAndMathml` emits a
// `.katex-mathml` accessibility tree this CSS clips to 1px; without it every equation paints twice.
import 'katex/dist/katex.min.css';
import { mathErrorNode, type MathRender } from './math-renderer';

/** `throwOnError: false` paints a malformed formula as `mathErrorNode` rather than throwing.
 *  KaTeX draws no colors of its own, so it has no use for the theme. */
export const katexRenderer = (source: string, { display }: { display: boolean }): MathRender => {
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
		return { dom: mathErrorNode(source, message), error: message };
	}
	return { dom: container };
};
