/**
 * A number that changes whenever a byte-writing door announces it, so a whole-document
 * derivation can memoize over a `$state` document that is mutated IN PLACE and never changes
 * identity. Reading it inside a `$derived` subscribes that reader to every edit. The doors are
 * censused (G4.52): the commit ceremony announces every structural write at its publish, and the
 * writers outside it announce their own.
 */

export interface ContentVersion {
	/** The current key, stable until a door bumps it. */
	read(): number;
	/** Announce that this door moved the document's serialized bytes. */
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
