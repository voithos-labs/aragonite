/**
 * Says whether a commit is running. The commit steps in `editor-actions` bracket their
 * synchronous body with it, and `reactivity` reads it so decorations never read a half-applied
 * tree. It lives here because both sides import downward: the flag in `editor-actions` would
 * close a cycle. It ships in production builds, because the deferral it drives is production
 * behavior (G4.61).
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
