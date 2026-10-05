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
	type FencedSource
} from '$lib/plugin';

const FENCE = '$$';

const unsliced = (text: string): FencedSource => ({ opener: '', body: text, closer: '' });

/** Both block forms are an opener line, a body and a closer line. GitHub's ```math reads as a code
 *  fence does; the `$$` form closes on a line that is exactly `$$`, or on line 0 itself. */
function sliceMathSource(text: string): FencedSource {
	if (!text.startsWith(FENCE)) return sliceFencedSource(text) ?? unsliced(text);
	const firstBreak = text.indexOf('\n');
	if (firstBreak === -1) {
		return text.length >= 4 && text.endsWith(FENCE)
			? { opener: FENCE, body: text.slice(2, -2), closer: FENCE }
			: unsliced(text);
	}
	if (displayLines(text)[0].text !== FENCE) return unsliced(text);
	const opener = text.slice(0, firstBreak + 1);
	const rest = text.slice(opener.length);
	const lastBreak = rest.lastIndexOf('\n');
	const lastLine = rest.slice(lastBreak + 1);
	if (lastLine !== FENCE) return { opener, body: rest, closer: '' };
	return { opener, body: rest.slice(0, lastBreak + 1), closer: lastLine };
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

/** A block with no body line (`$$$$`, `$$\n$$`) has no caret position once the fence lines hide,
 *  so it gains one empty body line with the caret on it, ended like the opener line. */
export function completeBareMathSource(
	text: string,
	lineEnding: string
): { text: string; caret: number } | null {
	const { opener, body, closer } = sliceMathSource(text);
	if (!opener || !closer) return null;
	if (body.includes('\n') || !isBlankText(body)) return null;
	const [openerLine] = displayLines(opener);
	// A one-line `$$$$` has no ending of its own to repeat, so it takes the block's.
	const ending = openerLine.ending || lineEnding;
	return {
		text: openerLine.text + ending + ending + closer,
		caret: openerLine.text.length + ending.length
	};
}

export function renderMathSource(text: string): DocumentFragment {
	return renderFencedSource(sliceMathSource(text), (body) => highlightCode(body, 'latex'));
}
