/**
 * Whether pressing Enter leaves a fenced code block. An unclosed fence leaves by writing its own
 * closer: the gesture creates a block below, and without a closer a reload would absorb that
 * block back into the fence. `none` means Enter falls through to editing inside the block.
 */

import type { FencedCodeMetadata } from '../../../core/nodes';
import { trailingLineEnding } from '../../../core/lines';
import { matchFenceClose } from '../../../core/parsers/fence-syntax';

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

		const onEmptyLineBeforeCloser =
			offset >= 1 &&
			text[offset - 1] === '\n' &&
			text[offset] === '\n' &&
			matchFenceClose(lineAt(text, offset + 1), meta.fenceMarker, meta.fenceLength);
		if (onEmptyLineBeforeCloser) {
			return { kind: 'exitWithEdit', newText: text.slice(0, offset) + text.slice(offset + 1) };
		}

		return { kind: 'none' };
	}

	if (offset === text.length && text.endsWith('\n')) {
		const ending = trailingLineEnding(text);
		const body = text.slice(0, text.length - ending.length);
		const closer = meta.fenceMarker.repeat(meta.fenceLength);
		return { kind: 'closeAndExit', newText: body + ending + closer };
	}
	return { kind: 'none' };
}

/**
 * The block's other way out: a closer typed on the body's empty last line. Every other editor
 * reads that run as "done here", and the bytes never land, because written they would be a body
 * line that reads as the closer, which the fence rule can only answer by growing the fence. A run
 * anywhere else is content, and growing the fence there keeps its CommonMark meaning.
 */
export function computeTypedFenceExit(input: TypedFenceExitInput): TypedFenceExitResult {
	const { text, offset, meta, typed } = input;
	const none = { kind: 'none' } as const;
	if (!meta.closed || typed !== meta.fenceMarker) return none;

	// The caret must sit at the end of a line that has one below it: the closer's.
	const ending = /^\r?\n/.exec(text.slice(offset));
	if (!ending) return none;
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const run = text.slice(lineStart, offset);
	if (run !== meta.fenceMarker.repeat(run.length) || run.length + 1 < meta.fenceLength) return none;

	const below = offset + ending[0].length;
	if (!matchFenceClose(lineAt(text, below), meta.fenceMarker, meta.fenceLength)) return none;
	// The run's line goes with the exit, as Enter's own exit takes the blank line.
	return { kind: 'exitWithEdit', newText: text.slice(0, lineStart) + text.slice(below) };
}

// ── Internal ────────────────────────────────────────────────────────────────

// The one physical line beginning at `start`, without its trailing newline.
function lineAt(text: string, start: number): string {
	const end = text.indexOf('\n', start);
	return end === -1 ? text.slice(start) : text.slice(start, end);
}
