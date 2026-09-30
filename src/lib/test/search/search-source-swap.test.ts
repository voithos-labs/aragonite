import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { makeSearchHarness } from './harness';

// A swap and an edit in place both bump the edit counter, so the generation counter is the
// only way to tell them apart: only the `source` prop branch bumps it.
function makeSwapHarness(source: string) {
	let doc = parse(source);
	let generation = 0;
	const { engine, state } = makeSearchHarness(source, {
		getDoc: () => doc,
		getDocumentGeneration: () => generation
	});
	return {
		state,
		currentDoc: () => doc,
		notifyEdit: () => engine.notifyEdit(),
		// What the editor's `source !== lastSource` branch does: a fresh tree, a generation bump,
		// then the edit notification any commit also sends.
		swapTo(next: string) {
			doc = parse(next);
			generation++;
			engine.notifyEdit();
		}
	};
}

describe('SearchState across a document swap', () => {
	it('restarts navigation at the first match', () => {
		const h = makeSwapHarness('cat\n\ncat\n\ncat\n');
		h.state.open();
		h.state.setQuery('cat');
		h.state.next();
		h.state.next();
		expect(h.state.activeIndex).toBe(2); // 3 / 3

		// Five matches, so the clamp, which only moves down, leaves the kept position alone.
		h.swapTo('cat cat\n\ncat cat\n\ncat\n');
		expect(h.state.matches).toHaveLength(5);
		expect(h.state.activeIndex).toBe(0);
	});

	it('restarts even when the new document has fewer matches than the old position', () => {
		// The clamp would also land on 0 here; this checks that the restart comes from the swap,
		// not from an overrun that happens to coincide with it.
		const h = makeSwapHarness('cat\n\ncat\n\ncat\n');
		h.state.open();
		h.state.setQuery('cat');
		h.state.next();
		h.swapTo('cat cat\n');
		expect(h.state.matches).toHaveLength(2);
		expect(h.state.activeIndex).toBe(0);
	});

	it('an in-place edit keeps the active position', () => {
		// A deliberate exception: the user still owns their place in a document that was edited,
		// not replaced. Only the swap discards it.
		const h = makeSwapHarness('cat\n\ncat\n\ncat\n');
		h.state.open();
		h.state.setQuery('cat');
		h.state.next();
		h.state.next();
		h.currentDoc().children[2].raw = 'cat cat\n';
		h.notifyEdit();
		expect(h.state.matches).toHaveLength(4);
		expect(h.state.activeIndex).toBe(2);
	});
});
