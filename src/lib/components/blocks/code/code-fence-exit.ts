/**
 * Whether pressing Enter leaves a fenced code block. An unclosed fence leaves by writing its own
 * closer: the gesture creates a block below, and without a closer a reload would absorb that
 * block back into the fence. `none` means Enter falls through to editing inside the block.
 */

import type { FencedCodeMetadata } from '../../../core/nodes';
import { lineEndingAt, ownTrailingLineEnding, splitLines } from '../../../core/lines';
import { findFenceCloser } from '../../../core/parsers/fence-syntax';

export interface FenceExitInput {
	text: string;
	offset: number;
	meta: FencedCodeMetadata;
}

export type FenceExitResult =
	| { kind: 'exit' }
	| { kind: 'exitWithEdit'; newText: string }
	// Unclosed fence: the trailing blank line is replaced by the closer line written here.
	| { kind: 'closeAndExit'; newText: string }
	| { kind: 'none' };

export interface TypedFenceExitInput extends FenceExitInput {
	/** The one character the pending `insertText` would write. */
	typed: string;
}

/** A typed closer either leaves the block, taking its own line with it, or is just a byte. */
export type TypedFenceExitResult = Extract<FenceExitResult, { kind: 'exitWithEdit' | 'none' }>;

// ── Public API ──────────────────────────────────────────────────────────────

export function computeFenceExit(input: FenceExitInput): FenceExitResult {
	const { text, offset, meta } = input;

	if (meta.closed) {
		if (offset === text.length) return { kind: 'exit' };

		// The caret starts an empty line: a break before it, and its own break right at it.
		const ending = lineEndingAt(text, offset);
		const onEmptyLineBeforeCloser =
			offset >= 1 &&
			text[offset - 1] === '\n' &&
			ending !== '' &&
			startsCloserLine(text, offset + ending.length, meta);
		if (onEmptyLineBeforeCloser) {
			return {
				kind: 'exitWithEdit',
				newText: text.slice(0, offset) + text.slice(offset + ending.length)
			};
		}

		return { kind: 'none' };
	}

	const ending = ownTrailingLineEnding(text);
	if (offset === text.length && ending !== '') {
		const body = text.slice(0, text.length - ending.length);
		const closer = meta.fenceMarker.repeat(meta.fenceLength);
		return { kind: 'closeAndExit', newText: body + ending + closer };
	}
	return { kind: 'none' };
}

/**
 * The block's other way out: a closer run typed on the body's empty last line leaves the block
 * and its bytes never land (written, the fence rule would grow the fence). A run anywhere else
 * is content.
 */
export function computeTypedFenceExit(input: TypedFenceExitInput): TypedFenceExitResult {
	const { text, offset, meta, typed } = input;
	const none = { kind: 'none' } as const;
	if (!meta.closed || typed !== meta.fenceMarker) return none;

	// The caret must sit at the end of a line that has one below it: the closer's.
	const ending = lineEndingAt(text, offset);
	if (ending === '') return none;
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const run = text.slice(lineStart, offset);
	if (run !== meta.fenceMarker.repeat(run.length) || run.length + 1 < meta.fenceLength) return none;

	const below = offset + ending.length;
	if (!startsCloserLine(text, below, meta)) return none;
	// The run's line goes with the exit, as Enter's own exit takes the blank line.
	return { kind: 'exitWithEdit', newText: text.slice(0, lineStart) + text.slice(below) };
}

// ── Internal ────────────────────────────────────────────────────────────────

/** Whether the line starting at `offset` closes the block's fence. */
function startsCloserLine(text: string, offset: number, meta: FencedCodeMetadata): boolean {
	const line = splitLines(text.slice(offset)).slice(0, 1);
	return (
		findFenceCloser(line, 0, line.length, {
			marker: meta.fenceMarker,
			length: meta.fenceLength
		}) === 0
	);
}
