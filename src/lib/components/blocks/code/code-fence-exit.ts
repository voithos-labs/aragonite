/**
 * Pure decision for "does pressing Enter exit a fenced code block?". Closed
 * fences exit at the end or by stripping a blank line before the closer;
 * unclosed fences exit when a prior Enter already left a trailing newline.
 * Returns `none` when Enter should fall through to in-block edit handling.
 */

import type { FencedCodeMetadata } from '../../../core/nodes';

export interface FenceExitInput {
	text: string;
	offset: number;
	meta: FencedCodeMetadata;
}

export type FenceExitResult =
	| { kind: 'exit' }
	| { kind: 'exitWithEdit'; newText: string }
	| { kind: 'none' };

// ── Public API ──────────────────────────────────────────────────────────────

export function computeFenceExit(input: FenceExitInput): FenceExitResult {
	const { text, offset, meta } = input;

	if (meta.closed) {
		if (offset === text.length) return { kind: 'exit' };

		const fenceChars = meta.fenceMarker.repeat(meta.fenceLength);
		const onEmptyLineBeforeCloser =
			offset >= 1 &&
			text[offset - 1] === '\n' &&
			text[offset] === '\n' &&
			text.slice(offset + 1, offset + 1 + fenceChars.length) === fenceChars;
		if (onEmptyLineBeforeCloser) {
			return { kind: 'exitWithEdit', newText: text.slice(0, offset) + text.slice(offset + 1) };
		}

		return { kind: 'none' };
	}

	if (offset === text.length && text.endsWith('\n')) {
		return { kind: 'exitWithEdit', newText: text.slice(0, -1) };
	}
	return { kind: 'none' };
}
