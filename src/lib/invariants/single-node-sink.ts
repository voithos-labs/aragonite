/**
 * G1.35 — a sink holding exactly one slot installs exactly one node. Bytes that reparse to
 * several blocks are refused before the write, never truncated to the first (a line vanishes from
 * the document) and never written whole into the surviving slot (the tree stops agreeing with its
 * own reload). Arriving plural is legal; installing plural is not, and this is asked at the
 * install so a sink that forgets the refusal answers for what it actually wrote.
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
