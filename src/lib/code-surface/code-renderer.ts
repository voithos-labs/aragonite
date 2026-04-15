/**
 * Code-block renderer. Given a fencedCode CstNode, produces a DocumentFragment
 * with dimmed marker spans for the opener/closer lines and tokenized spans for
 * the body (via highlight.js). Invariant:
 *
 *   fragment.textContent === trimTrailingLineEnding(node.raw)
 */

import type { CstNode, FencedCodeMetadata } from '../core/nodes';

// ── Public API ───────────────────────────────────────────────────────────────

export interface FencedCodeSlice {
	openerLine: string;
	body: string;
	closerLine: string;
	infoString: string;
}

/**
 * Split a fencedCode node's raw into opener / body / closer regions using
 * metadata.fenceMarker, metadata.fenceLength, metadata.info, and metadata.closed.
 */
export function sliceFencedCode(node: CstNode): FencedCodeSlice {
	const meta = node.metadata as FencedCodeMetadata;
	const raw = node.raw;

	const firstNewline = raw.indexOf('\n');
	if (firstNewline === -1) {
		return { openerLine: raw, body: '', closerLine: '', infoString: meta.info ?? '' };
	}

	const openerLine = raw.slice(0, firstNewline + 1);

	if (!meta.closed) {
		return {
			openerLine,
			body: raw.slice(openerLine.length),
			closerLine: '',
			infoString: meta.info ?? ''
		};
	}

	const closerStart = findClosingFenceStart(raw, openerLine.length, meta.fenceMarker, meta.fenceLength);
	return {
		openerLine,
		body: raw.slice(openerLine.length, closerStart),
		closerLine: raw.slice(closerStart),
		infoString: meta.info ?? ''
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

function findClosingFenceStart(
	raw: string,
	searchStart: number,
	fenceMarker: '`' | '~',
	fenceLength: number
): number {
	const fencePattern = new RegExp(`^ {0,3}${escapeRegex(fenceMarker)}{${fenceLength},}\\s*$`);

	let lineEnd = raw.length;
	while (lineEnd > searchStart) {
		const lineStart = raw.lastIndexOf('\n', lineEnd - 2) + 1;
		if (lineStart < searchStart) break;
		const line = raw.slice(lineStart, lineEnd).replace(/\n$/, '');
		if (fencePattern.test(line)) {
			return lineStart;
		}
		lineEnd = lineStart;
	}

	// Unreachable when the parser's `closed` flag is consistent with raw.
	return raw.length;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
