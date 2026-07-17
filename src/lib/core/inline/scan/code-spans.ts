/**
 * Backtick handler over the shared run index in ../backticks.ts. A matched span
 * covers fences + content; `text` holds the raw content bytes, unfolded — spec
 * display folding is the conformance normalizer's. Unmatched runs stay in the
 * pending text run whole, so an inner backtick of the run is never retried as
 * its own opener.
 */

import { findBacktickCloser, indexBacktickRuns } from '../backticks';
import { appendNode, type ScanContext } from './scan-state';

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
