// @vitest-environment jsdom
//
// Backspace at offset 0 of a blockquote's FIRST child lifts it out; one child later the
// same keystroke merges instead. Neither is in BlockquoteBlock.svelte — the arm is picked
// by the descriptor's `unwrapRole.{firstChild,middleChild}Backspace`, read by
// `createNestedBlockEdit` and dispatched into `firstChildUnwrapStrategies`. Four parts have
// to agree, each unit tested alone; a mount is the only level where the agreement shows.
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

	it('merges a middle child into its predecessor instead of unwrapping', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe('> alphabeta\n');
	});

	it('leaves a mid-content Backspace to the block itself', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		await pressKeyAt(mounted, [0, 0], 3, BACKSPACE);

		expect(mounted.source()).toBe('> alpha\n');
	});
});
