import { describe, it, expect } from 'vitest';
import { createReaderDisclosure } from '$lib/plugins/details/details-disclosure.svelte';

// The reading-mode disclosure: view state only. Its dependency object carries no
// commit door, which is what makes a reading-mode toggle unable to write bytes —
// the property is type-level here and byte-pinned in the presentation e2e.

describe('createReaderDisclosure', () => {
	it("shows the document's state through until the reader touches it", () => {
		let documentOpen = false;
		const disclosure = createReaderDisclosure({ isDocumentOpen: () => documentOpen });

		expect(disclosure.open).toBe(false);
		// A live read, not a snapshot: an undo landing while a reader looks at it must
		// show through, exactly as it does before any flip.
		documentOpen = true;
		expect(disclosure.open).toBe(true);
	});

	it('flips away from the document state and back', () => {
		const disclosure = createReaderDisclosure({ isDocumentOpen: () => false });

		disclosure.toggle();
		expect(disclosure.open).toBe(true);
		disclosure.toggle();
		expect(disclosure.open).toBe(false);
	});

	it('first flip is relative to the document state, not to a default', () => {
		// An open-in-the-document section must CLOSE on the reader's first click, not
		// re-open — a naive `flipped = !flipped` off a `false` seed does the latter.
		const disclosure = createReaderDisclosure({ isDocumentOpen: () => true });

		disclosure.toggle();
		expect(disclosure.open).toBe(false);
	});

	it('reset drops the flip so the document state is the only truth again', () => {
		let documentOpen = false;
		const disclosure = createReaderDisclosure({ isDocumentOpen: () => documentOpen });
		disclosure.toggle();
		expect(disclosure.open).toBe(true);

		disclosure.reset();
		expect(disclosure.open).toBe(false);
		// And it tracks the document again, rather than being frozen at the reset value.
		documentOpen = true;
		expect(disclosure.open).toBe(true);
	});
});
