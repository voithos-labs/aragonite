/**
 * G1.156: an undo or redo leaves the document at its entry's bytes. A write that lands while the
 * entry is being installed (a block repairing itself as the caret leaves it, say) would be a new
 * edit inside the undo, and would clear the redo stack.
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
