/**
 * Commit-in-progress flag. The ceremony (editor-actions) brackets its synchronous body; the
 * decoration engine (reactivity) reads it to keep a source off a half-applied tree. A leaf,
 * so both read it downward — a flag in editor-actions would close a cycle.
 */

let inCommit = false;

export function beginCommit(): void {
	inCommit = true;
}

export function endCommit(): void {
	inCommit = false;
}

export function isCommitInProgress(): boolean {
	return inCommit;
}
