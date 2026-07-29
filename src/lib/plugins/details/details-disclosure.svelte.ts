/**
 * The reader's disclosure — the half of the `<details>` toggle that writes nothing.
 *
 * Reading mode never writes bytes, but a reader still has to be able to open a
 * collapsed section to read it. So in that mode the toggle flips VIEW state, and
 * this module is the reason it cannot become an edit: its dependencies carry no
 * commit door, so nothing reachable from here can reach `updateOwnMetadata`. The
 * component chooses this handler for reading mode and its committing one otherwise,
 * which makes the whole rule one mode read at one site.
 *
 * Absent-by-default rather than seeded-on-entry: while the reader has not touched a
 * disclosure, the document's own `open` shows through, so "entering reading mode
 * starts from the document's state" holds for every block — including one windowed
 * out at the moment of the flip, which no entry hook could have reached.
 *
 * Scope is the component instance, the same scope every other plugin view state has
 * (a diagram's zoom, an inline reveal). Two deliberate consequences: leaving reading
 * mode drops the flip, and a block windowed out and back returns to the document's
 * state — the flip is ephemeral, and the alternative (state outliving its block)
 * would put a view state on screen in a mode whose bytes disagree with it.
 */

export interface ReaderDisclosure {
	/** Effective open state: the reader's flip if they made one, else the document's. */
	readonly open: boolean;
	/** Flip the view state. Reaches no commit — there is none in scope. */
	toggle(): void;
	/** Drop the flip; the document's own state is the only truth again. */
	reset(): void;
}

export function createReaderDisclosure(deps: {
	/** Live read of the document's own `open` — never a snapshot. */
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
			// Conditional: an unconditional write would re-invalidate every reader of
			// `open` on each pass of the effect that calls this.
			if (flipped !== null) flipped = null;
		}
	};
}
