// @vitest-environment jsdom
//
// The blockquote's ONE behavioral override: Enter on an empty trailing paragraph leaves
// the quote. `createContainerBlock` wires `createBlockquoteOverrides` into the nested
// bundle and the component names nothing to select it, so its arrival is invisible from
// the source — which is why both presses are driven here rather than seeded.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

describe('blockquote Enter override', () => {
	it('exits the quote on a second Enter, the minted blank replacing the empty line', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		// Two `>` lines: the split's blank-line separator plus the empty paragraph it made.
		// Without the separator a line typed there would lazily continue `alpha` on reload.
		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n');
	});

	// Miss-analysis: the exit's only pins seeded a quote at document end, where the
	// move-past-end append happened to mint the blank the exit itself never did — so the
	// whole "a block follows" class, and with it Enter-as-down-nav, went unobserved.
	it('exits before a following block by minting the gap, not entering the block', async () => {
		mounted = mountEditor({ source: '> alpha\n\nbeta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n\nbeta\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n\nbeta\n');
	});

	// A table can't host a caret at its top edge and the quote declares no gap edge, so
	// down-nav here left the boundary with no insertion point at all.
	it('mints the gap before a block the caret cannot open one in', async () => {
		mounted = mountEditor({ source: '> alpha\n\n| a | b |\n| - | - |\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n\n| a | b |\n| - | - |\n');
	});

	// One level per press, the list outdent's convention: the first exit leaves a quoted
	// blank inside the outer quote, not a document paragraph two levels down.
	it('escapes a nested quote one level per Enter', async () => {
		mounted = mountEditor({ source: '> Outer\n> > Inner\n' });

		await pressKeyAt(mounted, [0, 1, 0], 5, ENTER);
		expect(mounted.source()).toBe('> Outer\n> > Inner\n> >\n> >\n');

		await pressKeyAt(mounted, [0, 1, 1], 0, ENTER);
		expect(mounted.source()).toBe('> Outer\n> > Inner\n>\n>\n');

		await pressKeyAt(mounted, [0, 2], 0, ENTER);
		expect(mounted.source()).toBe('> Outer\n> > Inner\n\n\n');
	});

	// Non-vacuity: the exit case alone passes even if the override swallowed every Enter.
	it('leaves an Enter on a non-trailing child to the default split', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);

		// One new quoted blank line, not two: `beta` already carries the run's separator.
		expect(mounted.source()).toBe('> alpha\n>\n>\n> beta\n');
	});
});
