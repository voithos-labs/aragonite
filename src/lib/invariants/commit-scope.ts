/**
 * Commit-in-progress flag (DEV-only), so the decoration engine can assert no source runs
 * inside a half-applied commit. A leaf, so both the ceremony (editor-actions) and the
 * engine (reactivity) read it downward; a flag in editor-actions would close a cycle.
 */

import { DEV } from 'esm-env';

let inCommit = false;

export function beginCommit(): void {
	if (DEV) inCommit = true;
}

export function endCommit(): void {
	if (DEV) inCommit = false;
}

export function isCommitInProgress(): boolean {
	return inCommit;
}
