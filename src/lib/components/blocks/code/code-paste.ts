/**
 * Pure paste pipeline for fenced code blocks: splice the text in, then hand the
 * result to the write seam every route shares (`code-fence-write.ts`), which grows
 * the fence past any line the paste turned into a terminator. The bump used to be
 * computed here from the pasted run alone — that missed a run the splice FORMS at
 * its seam, and it was the reason typing the same characters had no such rule.
 */

import { reconcileFenceWrite } from './code-fence-write';

export interface CodePasteInput {
	display: string;
	selection: { start: number; end: number };
	pasted: string;
	fenceMarker: '`' | '~';
	fenceLength: number;
	closed: boolean;
}

export interface CodePasteResult {
	text: string;
	cursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * A paste is literal content, so a run it lands — or forms against the bytes already
 * there — grows the fence instead of terminating the block. Closed blocks grow both
 * runs; an open one grows its opener, since it has no closer to keep in step.
 */
export function computeCodePaste(input: CodePasteInput): CodePasteResult {
	const { display, selection, pasted, fenceMarker, fenceLength, closed } = input;
	const { start, end } = selection;

	const written = reconcileFenceWrite({
		display: display.slice(0, start) + pasted + display.slice(end),
		caret: start + pasted.length,
		fence: { marker: fenceMarker, length: fenceLength, closed },
		mode: 'literal'
	});
	return { text: written.display, cursor: written.caret };
}
