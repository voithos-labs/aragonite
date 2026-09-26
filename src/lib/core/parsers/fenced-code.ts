import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';
import { findFenceCloser, type FenceRun } from './fence-syntax';

/** A fence's extent from its opener line: `closer` is the line that closes it, or -1. */
export interface FenceScan {
	closer: number;
	/** Lines taken, the opener and closer included; to the end of the range when nothing closes. */
	consumed: number;
	raw: string;
	/** The lines between the fence lines, verbatim. */
	body: string;
}

/** Scans the fence opened at `ctx.index` the way the parser does: it closes on its first closer. */
export function scanFence(
	ctx: { lines: ParsedLine[]; index: number; end: number },
	fence: FenceRun
): FenceScan {
	const closer = findFenceCloser(ctx.lines, ctx.index + 1, ctx.end, fence);
	const stop = closer === -1 ? ctx.end : closer + 1;
	return {
		closer,
		consumed: stop - ctx.index,
		raw: joinRaw(ctx.lines, ctx.index, stop),
		body: joinRaw(ctx.lines, ctx.index + 1, closer === -1 ? ctx.end : closer)
	};
}

export function parseFencedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	fence: { marker: '`' | '~'; length: number; info: string }
): BlockOpenerResult {
	const scan = scanFence({ lines, index: startIndex, end: endIndex }, fence);
	return {
		node: {
			kind: 'fencedCode',
			leadingTrivia,
			raw: scan.raw,
			metadata: {
				fenceMarker: fence.marker,
				fenceLength: fence.length,
				info: fence.info,
				closed: scan.closer !== -1
			}
		},
		consumed: scan.consumed
	};
}
