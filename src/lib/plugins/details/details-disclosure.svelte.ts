/**
 * The half of the `<details>` toggle that writes nothing: reading mode must let a
 * reader open a collapsed section without touching bytes, and these deps carry no
 * commit door, so no flip reachable from here can become an edit. Absent-by-default
 * rather than seeded on entry, so the document's own `open` shows through even for a
 * block windowed out at the moment of the flip. Scoped to the instance, so it is ephemeral.
 */

export interface ReaderDisclosure {
	/** The reader's flip if they made one, else the document's own state. */
	readonly open: boolean;
	toggle(): void;
	reset(): void;
}

export function createReaderDisclosure(deps: {
	/** Getter, so the document's `open` is read live and never snapshotted. */
	isDocumentOpen: () => boolean;
}): ReaderDisclosure {
	let flipped = $state<boolean | null>(null);
	return {
		get open() {
			return flipped ?? deps.isDocumentOpen();
		},
		toggle() {
			flipped = !(flipped ?? deps.isDocumentOpen());
		},
		reset() {
			// Conditional: an unconditional write re-invalidates every reader of `open`
			// on each pass of the effect that calls this.
			if (flipped !== null) flipped = null;
		}
	};
}
