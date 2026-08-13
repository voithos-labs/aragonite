/**
 * G1.35 — a sink holding exactly one slot installs exactly one node. Bytes that reparse to
 * several blocks are refused there, never truncated to the first (a line vanishes from the
 * document) and never written whole into the surviving slot (the tree stops agreeing with
 * its own reload). Arriving plural is legal; installing plural is not.
 */

import type { InvariantViolation } from './assert';

export function checkSingleNodeSink(
	sink: string,
	blockCount: number,
	installed: boolean
): InvariantViolation | null {
	if (!installed || blockCount <= 1) return null;
	return {
		code: 'single-node-sink',
		message: `${sink} installed bytes reading as ${blockCount} blocks into a one-node slot`,
		detail: { sink, blockCount }
	};
}
