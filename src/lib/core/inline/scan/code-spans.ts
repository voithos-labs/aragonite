/**
 * Backtick handler over the shared matching core in ../backticks.ts. A
 * matched span covers fences + content; `text` holds the raw content bytes,
 * unfolded — spec display folding is the conformance normalizer's. Unmatched
 * runs stay in the pending text run whole, so an inner backtick of the run
 * is never retried as its own opener.
 */

import { matchBacktickRun } from '../backticks';
import { appendNode, type ScanContext } from './scan-state';

export function handleBacktick(ctx: ScanContext): void {
	const { tickLen, closeStart } = matchBacktickRun(ctx.raw, ctx.pos, ctx.end);
	if (closeStart === -1) {
		ctx.pos += tickLen;
		return;
	}
	appendNode(ctx, {
		kind: 'inlineCode',
		start: ctx.pos,
		end: closeStart + tickLen,
		text: ctx.raw.slice(ctx.pos + tickLen, closeStart)
	});
}
