// The `$$` or ```math split the painter draws, read back off the DOM it builds.
import { renderMathSource } from '#lib/plugins/latex/math-source.js';
import type { MathSource } from '#lib/plugins/latex/math-shape.js';

/** Opener and closer read off the fence-line markers, the body and the text past the closer as
 *  painted; null when the painter draws no fence line. */
export function paintedSplit(text: string): MathSource | null {
	const nodes = Array.from(renderMathSource(text).childNodes);
	const fences = nodes.flatMap((node, i) =>
		node instanceof Element && node.classList.contains('md-fence-line') ? [i] : []
	);
	if (fences.length === 0) return null;
	const [openerAt, closerAt] = fences;
	const textOf = (from: number, to?: number) =>
		nodes
			.slice(from, to)
			.map((node) => node.textContent ?? '')
			.join('');
	const markers = closerAt === undefined ? [] : [...nodes[closerAt].childNodes];
	const closerMarker = markers.filter((node) => node instanceof Element).pop();
	return {
		opener: textOf(openerAt, openerAt + 1),
		body: textOf(openerAt + 1, closerAt),
		closer: closerMarker?.textContent ?? '',
		after: closerAt === undefined ? '' : textOf(closerAt + 1)
	};
}
