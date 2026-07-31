/**
 * Pure auto-pair decision for code-block `insertText` events: the component owns
 * the DOM and CST plumbing, this owns the splice math.
 */

import { getCloserFor, shouldAutoClose, shouldSkipClose } from './code-editing';

export interface AutoPairInput {
	text: string;
	selection: { start: number; end: number };
	typed: string;
	/** True when the host block is an unclosed backtick fence — backticks would extend it. */
	unclosedBacktickFence?: boolean;
}

export type AutoPairResult =
	| { kind: 'pair'; newText: string; caretOffset: number }
	| { kind: 'skip'; caretOffset: number }
	| { kind: 'wrap'; newText: string; selection: { start: number; end: number } };

// ── Public API ──────────────────────────────────────────────────────────────

export function computeAutoPair(input: AutoPairInput): AutoPairResult | null {
	const { text, selection, typed, unclosedBacktickFence = false } = input;
	const closer = getCloserFor(typed);
	const collapsed = selection.start === selection.end;

	if (!collapsed) {
		if (closer === null) return null;
		const wrapped =
			text.slice(0, selection.start) +
			typed +
			text.slice(selection.start, selection.end) +
			closer +
			text.slice(selection.end);
		return {
			kind: 'wrap',
			newText: wrapped,
			selection: { start: selection.start + 1, end: selection.end + 1 }
		};
	}

	const offset = selection.start;

	if (shouldSkipClose(text, offset, typed)) {
		return { kind: 'skip', caretOffset: offset + 1 };
	}

	if (closer === null) return null;
	if (typed === '`' && unclosedBacktickFence) return null;
	if (!shouldAutoClose(text, offset, typed)) return null;

	return {
		kind: 'pair',
		newText: text.slice(0, offset) + typed + closer + text.slice(offset),
		caretOffset: offset + 1
	};
}
