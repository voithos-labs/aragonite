// @vitest-environment jsdom
//
// Rule U2: Backspace at offset 0 of a blockquote's FIRST child lifts that child out
// of the quote. Nothing in BlockquoteBlock.svelte says so — the behavior is selected
// by the descriptor's `unwrapRole.firstChildBackspace: 'lift-first-child'`, read by
// `createNestedBlockEdit` from the node's kind and dispatched into
// `firstChildUnwrapStrategies`. Four independent parts (descriptor, dispatcher,
// strategy table, the component's bundle wiring) have to agree, and each is unit
// tested alone; this is the only level where their agreement is observable.
//
// The middle-child arm is the declared contrast (`'default-merge'`), so the same
// keystroke one child later must merge instead of unwrap.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const BACKSPACE = { key: 'Backspace' };

describe('blockquote Backspace unwrap (U2)', () => {
	it('lifts the first child out of the quote, leaving the rest quoted', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('alpha\n> beta\n');
	});

	it('unwraps a sole child into a bare paragraph', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('alpha\n');
	});

	// `middleChildBackspace: 'default-merge'` — the same keystroke one child later is
	// an ordinary interior merge, and the quote survives it.
	it('merges a middle child into its predecessor instead of unwrapping', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe('> alphabeta\n');
	});

	// Not at offset 0: an ordinary in-block deletion, which must not reach the
	// unwrap dispatch at all.
	it('leaves a mid-content Backspace to the block itself', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		await pressKeyAt(mounted, [0, 0], 3, BACKSPACE);

		expect(mounted.source()).toBe('> alpha\n');
	});
});
