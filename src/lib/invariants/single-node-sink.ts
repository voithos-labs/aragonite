/**
 * G1.35: a write target that holds one block installs exactly one node. Bytes that reparse to
 * several blocks are refused before the write, never cut to the first (a line would vanish) nor
 * written whole into one position (the tree would disagree with its own reload). The check runs
 * at the write, so the caller that skipped the refusal is the one named.
 */

import type { InvariantViolation } from '../assert';

export function checkSingleNodeSink(sink: string, installed: number): InvariantViolation | null {
	if (installed <= 1) return null;
	return {
		code: 'single-node-sink',
		message: `${sink} installed ${installed} nodes into a one-node slot`,
		detail: { sink, installed }
	};
}
