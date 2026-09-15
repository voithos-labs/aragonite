/**
 * G1.35: a write target that holds exactly one block installs exactly one node. Bytes that reparse
 * to several blocks are refused before the write, never cut down to the first (a line would vanish
 * from the document) and never written whole into the one position (the tree would stop agreeing
 * with its own reload). Arriving with several blocks is legal, installing several is not, and the
 * check runs at the write so a caller that skipped the refusal is the one named.
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
