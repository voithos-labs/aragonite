/**
 * Pure paste pipeline for fenced code blocks: splice the text in, then hand the
 * result to the fence rule every path shares (`schema/fenced-code-raw.ts`).
 */

import { reconcileFenceWrite } from '../../../schema/fenced-code-raw';
import type { LineEnding } from '../../../core/lines';

export interface CodePasteInput {
	display: string;
	selection: { start: number; end: number };
	pasted: string;
	fenceMarker: '`' | '~';
	fenceLength: number;
	closed: boolean;
	/** The block's own line ending, for a closer line the rule puts back. */
	ending: LineEnding;
}

export interface CodePasteResult {
	text: string;
	cursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * A paste is literal content, so a run it lands, or one it forms against the bytes
 * already there, grows the fence instead of ending the block.
 */
export function computeCodePaste(input: CodePasteInput): CodePasteResult {
	const { display, selection, pasted, fenceMarker, fenceLength, closed, ending } = input;
	const { start, end } = selection;

	const written = reconcileFenceWrite({
		display: display.slice(0, start) + pasted + display.slice(end),
		caret: start + pasted.length,
		fence: { marker: fenceMarker, length: fenceLength, closed },
		mode: 'literal',
		ending
	});
	return { text: written.display, cursor: written.caret };
}
