/**
 * Commit-in-progress flag (DEV-only). The one commit ceremony marks its
 * synchronous body so the decoration engine can assert no source ever runs
 * inside a half-applied commit. A leaf so both the ceremony (editor-actions) and
 * the engine (reactivity) read it downward — a flag in editor-actions would close
 * a reactivity→editor-actions cycle. Untouched in production: the ceremony never
 * sets it and the engine's assert never checks it.
 */

let inCommit = false;

export function beginCommit(): void {
	if (import.meta.env.DEV) inCommit = true;
}

export function endCommit(): void {
	if (import.meta.env.DEV) inCommit = false;
}

export function isCommitInProgress(): boolean {
	return inCommit;
}
