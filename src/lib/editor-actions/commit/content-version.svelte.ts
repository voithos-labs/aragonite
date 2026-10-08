/**
 * A number bumped whenever the document's bytes change, so a whole-document `$derived` can
 * memoize over a `$state` document that is mutated in place and never changes identity.
 * Every place that writes bytes must bump it; a commit does so for each structural write (G4.52).
 */

export interface ContentVersion {
	read(): number;
	/** Call after changing the document's serialized bytes. */
	bump(): void;
}

export function createContentVersion(): ContentVersion {
	let version = $state(0);
	return {
		read: () => version,
		bump: () => {
			version++;
		}
	};
}
