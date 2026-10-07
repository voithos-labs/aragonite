/**
 * The block form's source as DOM, drawn the way a code block draws its own: the fence lines as
 * markers the marker-hiding modes collapse, the body as highlighted LaTeX tokens. It emits exactly
 * the source's text, so the DOM-to-offset traversal stays exact (G1.28). Anything not shaped like
 * a fence paints as plain tokens.
 */
import {
	displayLines,
	fenceBodyAsDrawn,
	highlightCode,
	isBlankText,
	renderFencedSource,
	sliceFencedSource,
	type LineEnding
} from '$lib/plugin';
import { readMathSource, reshapeMathSource, type MathEdit, type MathSource } from './math-shape';

/** Both block forms as an opener, a body and a closer: the `$$` form as `math-shape.ts` reads it,
 *  GitHub's ```math as a code fence reads. */
function sliceMathSource(text: string): MathSource {
	const dollars = readMathSource(text);
	if (dollars) return dollars;
	return { ...(sliceFencedSource(text) ?? { opener: '', body: text, closer: '' }), after: '' };
}

/**
 * Where the body sits inside the block's source. The fence lines paint no glyphs of their own,
 * so a point measured against the rendered equation can only name a place inside this span.
 */
export function mathBodySpan(text: string): { start: number; end: number } {
	const source = sliceMathSource(text);
	const start = source.opener.length;
	return { start, end: start + fenceBodyAsDrawn(source).length };
}

/** The edited source in the shape the block keeps: a one-line form a line break went into becomes
 *  the multi-line form, and a source with no body line gains one. Null leaves the edit as it is. */
export function reshapeMathEdit(
	text: string,
	caret: number,
	lineEnding: LineEnding
): MathEdit | null {
	const reshaped = reshapeMathSource(text, caret);
	return completeBareMathSource(reshaped?.text ?? text, lineEnding) ?? reshaped;
}

/** A block with no body line (`$$$$`, `$$\n$$`) has no caret position once the fence lines hide,
 *  so it gains one empty body line with the caret on it, ended like the opener line. */
function completeBareMathSource(text: string, lineEnding: LineEnding): MathEdit | null {
	const { opener, body, closer, after } = sliceMathSource(text);
	if (!opener || !closer) return null;
	if (body.includes('\n') || !isBlankText(body)) return null;
	const [openerLine] = displayLines(opener);
	// A one-line `$$$$` has no ending of its own to repeat, so it takes the block's.
	const ending = openerLine.ending || lineEnding;
	return {
		text: openerLine.text + ending + ending + closer + after,
		caret: openerLine.text.length + ending.length
	};
}

/** What follows the closer is outside the block, so it paints as plain text. */
export function renderMathSource(text: string): DocumentFragment {
	const source = sliceMathSource(text);
	const frag = renderFencedSource(source, (body) => highlightCode(body, 'latex'));
	if (source.after) frag.append(source.after);
	return frag;
}
