/**
 * G4.371: a block a plugin holds answers only where its node stands. The read moves the block's
 * top-level index through the runs each write reported and refuses a place another node holds.
 * Checked against a fresh walk: an answer the walk disagrees with, or a block lost from a slot no
 * write reported changing, means a write under-reported its runs.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView, NodeView } from '../core/node-views';
import { walkBlocks } from '../core/paths';

/** `answer` is the read's path for `node`, or null; `touched` says a reported run held its
 *  top-level block, and `covered` that every write since it was seen reported its runs. */
export function checkHeldBlockPlace(
	doc: DocumentView,
	node: NodeView,
	answer: readonly number[] | null,
	moved: { touched: boolean; covered: boolean }
): InvariantViolation | null {
	let fresh: number[] | null = null;
	walkBlocks(doc, (each, at) => (each === node ? ((fresh = at), 'stop') : undefined));
	const where = fresh ? `[${(fresh as number[]).join(', ')}]` : 'nowhere';
	if (answer) {
		if (fresh && answer.join() === (fresh as number[]).join()) return null;
		return held(`a held block read [${answer.join(', ')}], but its node stands ${where}`);
	}
	if (moved.touched || !moved.covered) return null;
	return held(
		`a held block lost its place, now ${where}, though no write reported its block changed`
	);
}

function held(message: string): InvariantViolation {
	return { code: 'held-block-place', message };
}
