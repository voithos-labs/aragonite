/**
 * The block form's source as DOM, shaped like a code block's: each fence line inside a
 * `.md-fence-line` wrapper that the marker-hiding modes collapse, the body as highlighted LaTeX
 * tokens. It emits exactly opener plus body plus closer, so the text is unchanged and the
 * DOM-to-offset traversal stays exact (G1.28). Anything not shaped like a fence paints as
 * plain tokens.
 */
import { highlightCode, matchFenceClose, matchFenceOpen } from '$lib/plugin';

const FENCE = '$$';

interface MathSlice {
	opener: string;
	body: string;
	closer: string;
}

const unsliced = (text: string): MathSlice => ({ opener: '', body: text, closer: '' });

/** Both block forms are an opener line, a body and a closer line; only the closer test differs,
 *  since GitHub's ```math carries its info string on the opener and closes on a bare fence. */
function sliceMathSource(text: string): MathSlice {
	const firstNewline = text.indexOf('\n');
	if (text.startsWith(FENCE)) {
		// One-line form: `$$x^2$$`.
		if (firstNewline === -1) {
			return text.length >= 4 && text.endsWith(FENCE)
				? { opener: FENCE, body: text.slice(2, -2), closer: FENCE }
				: unsliced(text);
		}
		if (text.slice(0, firstNewline) !== FENCE) return unsliced(text);
		return sliceFenceLines(text, firstNewline, (line) => line === FENCE);
	}
	if (firstNewline === -1) return unsliced(text);
	// CommonMark's fence rules stay the editor's: a closer repeats its opener's own marker, at
	// that length or longer.
	const fence = matchFenceOpen(text.slice(0, firstNewline));
	if (!fence) return unsliced(text);
	return sliceFenceLines(text, firstNewline, (line) =>
		matchFenceClose(line, fence.marker, fence.length)
	);
}

function sliceFenceLines(
	text: string,
	firstNewline: number,
	isCloser: (line: string) => boolean
): MathSlice {
	const opener = text.slice(0, firstNewline + 1);
	const rest = text.slice(opener.length);
	const lastNewline = rest.lastIndexOf('\n');
	const lastLine = lastNewline === -1 ? rest : rest.slice(lastNewline + 1);
	if (!isCloser(lastLine)) return { opener, body: rest, closer: '' };
	if (lastNewline === -1) return { opener, body: '', closer: lastLine };
	// The newline before the closer belongs to the closer's line (the code block's rule), so
	// collapsing that line leaves no blank line at the box's edge. The exception is a blank
	// body, where that newline is the only line the caret can sit on.
	const bodyWithEnding = rest.slice(0, lastNewline + 1);
	if (!/\S/.test(bodyWithEnding)) return { opener, body: bodyWithEnding, closer: lastLine };
	return { opener, body: rest.slice(0, lastNewline), closer: rest.slice(lastNewline) };
}

function fenceLine(text: string): HTMLSpanElement {
	const line = document.createElement('span');
	line.className = 'md-fence-line';
	const marker = document.createElement('span');
	marker.className = 'md-marker md-fence';
	marker.textContent = text.replace(/\n$/, '').replace(/^\n/, '');
	if (text.startsWith('\n')) line.appendChild(document.createTextNode('\n'));
	line.appendChild(marker);
	if (text.endsWith('\n')) line.appendChild(document.createTextNode('\n'));
	return line;
}

/**
 * Where the body sits inside the block's source. The fence lines paint no glyphs of their own,
 * so a point measured against the rendered equation can only name a place inside this span.
 */
export function mathBodySpan(text: string): { start: number; end: number } {
	const { opener, body } = sliceMathSource(text);
	return { start: opener.length, end: opener.length + body.length };
}

/**
 * A block with no body line at all (`$$$$`, `$$\n$$`, a ```math sitting straight on its closer)
 * has nowhere for a caret to sit once the fence lines hide, and Backspace has no byte to mean.
 * Every such block is completed the same way: opener, one empty body line, closer, caret on
 * that line, rebuilt from its own delimiters. A block with a body line, blank or not, is left
 * alone.
 */
export function completeBareMathSource(text: string): { text: string; caret: number } | null {
	const { opener, body, closer } = sliceMathSource(text);
	if (!opener || !closer) return null;
	if (body.includes('\n') || body.trim() !== '') return null;
	const openerLine = opener.replace(/\n$/, '');
	return { text: `${openerLine}\n\n${closer}`, caret: openerLine.length + 1 };
}

export function renderMathSource(text: string): DocumentFragment {
	const { opener, body, closer } = sliceMathSource(text);
	const frag = document.createDocumentFragment();
	if (opener) frag.appendChild(fenceLine(opener));
	frag.appendChild(highlightCode(body, 'latex'));
	// An empty last body line has only the hidden closer after it; the anchor gives the caret
	// that line (see `code-renderer.ts`).
	if (closer.startsWith('\n') && body.endsWith('\n')) {
		const anchor = document.createElement('br');
		anchor.dataset.caretAnchor = 'closer';
		frag.appendChild(anchor);
	}
	if (closer) frag.appendChild(fenceLine(closer));
	return frag;
}
