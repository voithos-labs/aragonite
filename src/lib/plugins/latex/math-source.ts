/**
 * The `$$` block's source as DOM, shaped like a code block's: each fence line in a
 * `.md-fence-line` wrapper the marker-hiding modes collapse, the body as LaTeX highlight
 * tokens. Text-preserving by construction — opener + body + closer is the input — so the
 * offset walk and G1.28 hold. Anything not shaped like a fence paints as plain tokens.
 */
import { highlightCode } from '$lib/plugin';

const FENCE = '$$';

interface MathSlice {
	opener: string;
	body: string;
	closer: string;
}

function sliceMathSource(text: string): MathSlice {
	if (!text.startsWith(FENCE)) return { opener: '', body: text, closer: '' };
	const firstNewline = text.indexOf('\n');
	// One-line form: `$$x^2$$`.
	if (firstNewline === -1) {
		if (text.length >= 4 && text.endsWith(FENCE)) {
			return { opener: FENCE, body: text.slice(2, -2), closer: FENCE };
		}
		return { opener: '', body: text, closer: '' };
	}
	if (text.slice(0, firstNewline) !== FENCE) return { opener: '', body: text, closer: '' };
	const opener = text.slice(0, firstNewline + 1);
	const rest = text.slice(opener.length);
	const lastNewline = rest.lastIndexOf('\n');
	const lastLine = lastNewline === -1 ? rest : rest.slice(lastNewline + 1);
	if (lastLine !== FENCE) return { opener, body: rest, closer: '' };
	if (lastNewline === -1) return { opener, body: '', closer: FENCE };
	// The newline before the closer belongs to the closer's line (the code block's rule), so
	// collapsing that line leaves no blank line at the box's edge — unless the body is blank,
	// where that newline IS the one line the caret can sit on.
	const bodyWithEnding = rest.slice(0, lastNewline + 1);
	if (!/\S/.test(bodyWithEnding)) return { opener, body: bodyWithEnding, closer: FENCE };
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
