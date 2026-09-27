/**
 * Backtick handler over the shared run index in ../backticks.ts. A matched span covers fences
 * plus content; `text` holds raw content bytes, unfolded (display folding is the normalizer's).
 * An unmatched run stays whole in the pending text, so an inner backtick is never retried.
 */

import type { InlineNode } from '../../nodes';
import { findBacktickCloser, indexBacktickRuns } from '../backticks';
import { appendNode, type ScanContext } from './scan-state';

/**
 * The width of each of a code span's two delimiter runs, read one way so every reader places a
 * code span's content the same. A matched span's runs are equal (§6.1), so they split what `text`
 * leaves evenly; 0 when there is no such split, and the whole node is then content.
 */
export function codeSpanFence(node: InlineNode): number {
	if (node.text === undefined) return 0;
	const fence = (node.end - node.start - node.text.length) / 2;
	return Number.isInteger(fence) && fence > 0 ? fence : 0;
}

export function handleBacktick(ctx: ScanContext): void {
	const { raw, pos, end } = ctx;
	let runEnd = pos;
	while (runEnd < end && raw[runEnd] === '`') runEnd++;
	const tickLen = runEnd - pos;

	if (ctx.backtickRuns === undefined) ctx.backtickRuns = indexBacktickRuns(raw, pos, end);
	const closeStart = findBacktickCloser(ctx.backtickRuns, tickLen, pos);
	if (closeStart === -1) {
		ctx.pos = runEnd;
		return;
	}
	appendNode(ctx, {
		kind: 'inlineCode',
		start: pos,
		end: closeStart + tickLen,
		text: raw.slice(pos + tickLen, closeStart)
	});
}
