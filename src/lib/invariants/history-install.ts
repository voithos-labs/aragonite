/**
 * G1.156: an undo or redo leaves the document at its entry's bytes. A write that lands while the
 * entry is being installed (a block repairing itself as the caret leaves it, say) would be a new
 * edit inside the undo, and would clear the redo stack.
 *
 * G1.246: a drawing's save lands before the undo reads its step, so that undo takes it back.
 */
import type { Document } from '../core/nodes';
import { serialize } from '../core/serializer';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkInstalledEntry(
	op: 'undo' | 'redo',
	snapshot: Document,
	doc: Document
): InvariantViolation | null {
	const expected = serialize(snapshot);
	const installed = serialize(doc);
	if (installed === expected) return null;
	let at = 0;
	while (installed[at] === expected[at]) at++;
	const excerpt = (text: string) => JSON.stringify(text.slice(at, at + 40));
	return {
		code: 'history-install',
		message: `${op} left the document off its entry's bytes at ${at}: ${excerpt(installed)}, not ${excerpt(expected)}`
	};
}

/** `waiting` drafts a save opened and left uncommitted when it returned. */
export function checkSavesCommitted(waiting: number): InvariantViolation | null {
	if (waiting === 0) return null;
	return {
		code: 'save-before-swap',
		message: `a drawing's save returned with ${waiting} draft(s) not yet committed; commit before save returns, or the undo can't take the write back`
	};
}
