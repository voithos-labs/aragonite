/**
 * Says whether a commit is running. The commit steps in `editor-actions` bracket their
 * synchronous body with it, and `reactivity` reads it so decorations never read a half-applied
 * tree. It lives here because both sides import downward: the counter in `editor-actions` would
 * close a cycle. It ships in production builds, because the deferral it drives is production
 * behavior (G4.61).
 */

// A depth, not a boolean: a commit started from an `edit` handler must not end the outer one.
let depth = 0;

export function beginCommit(): void {
	depth++;
}

export function endCommit(): void {
	depth--;
}

export function isCommitInProgress(): boolean {
	return depth > 0;
}
