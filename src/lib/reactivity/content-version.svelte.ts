/**
 * A number that changes whenever something that writes bytes says so, letting a
 * whole-document computation memoize over a `$state` document that is mutated in place and
 * never changes identity. Reading it inside a `$derived` subscribes that computation to edits.
 * Every writer is accounted for (G4.52): a commit announces each structural write as it writes
 * to state, and the writers outside a commit announce their own.
 */

export interface ContentVersion {
	/** The current value, stable until a writer bumps it. */
	read(): number;
	/** Announce that this writer changed the document's serialized bytes. */
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
