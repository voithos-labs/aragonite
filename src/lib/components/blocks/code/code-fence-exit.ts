/**
 * Pure decision for "does pressing Enter exit a fenced code block?". Closed
 * fences exit at the end or by stripping a blank line before the closer. An
 * unclosed fence the caret sits at the end of, on a trailing blank line, exits
 * by MINTING its own closer (`closeAndExit`): the gesture authors a block below
 * the fence, and without a closer a reload lazy-continuation absorbs that block
 * back into the open fence. Returns `none` when Enter falls through to in-block
 * edit handling.
 */

import type { FencedCodeMetadata } from '../../../core/nodes';
import { matchFenceClose } from '../../../core/parsers/fenced-code';

export interface FenceExitInput {
	text: string;
	offset: number;
	meta: FencedCodeMetadata;
}

export type FenceExitResult =
	| { kind: 'exit' }
	| { kind: 'exitWithEdit'; newText: string }
	// Unclosed fence: `newText` is the code display with its trailing blank line
	// replaced by the minted closer line (marker char × length, ending-matched).
	| { kind: 'closeAndExit'; newText: string }
	| { kind: 'none' };

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
		const ending = text.endsWith('\r\n') ? '\r\n' : '\n';
		const body = text.slice(0, text.length - ending.length);
		const closer = meta.fenceMarker.repeat(meta.fenceLength);
		return { kind: 'closeAndExit', newText: body + ending + closer };
	}
	return { kind: 'none' };
}

// The one physical line beginning at `start`, without its trailing newline.
function lineAt(text: string, start: number): string {
	const end = text.indexOf('\n', start);
	return end === -1 ? text.slice(start) : text.slice(start, end);
}
