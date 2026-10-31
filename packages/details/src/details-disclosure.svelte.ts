/**
 * The half of the `<details>` toggle that writes nothing: in reading mode a user may open a
 * collapsed section without touching bytes, and nothing handed in here can reach a commit.
 * Starts unset rather than copying the document's `open`, so a block that was not mounted
 * when the toggle happened still shows the document's own state. One per component instance.
 */

export interface ReaderDisclosure {
	/** What the user toggled it to, if they toggled it; otherwise the document's own state. */
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
			// Guarded: writing unconditionally would invalidate everything that reads
			// `open` on every pass of the effect that calls this.
			if (flipped !== null) flipped = null;
		}
	};
}
