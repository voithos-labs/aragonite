// @vitest-environment jsdom
// Enter on an empty trailing paragraph leaves the blockquote. `createContainerBlock` wires
// `createContainerExitOverrides` in without the component naming it, so both keystrokes are
// driven here rather than set up directly.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

/** The blocks on screen are the blocks these bytes reparse into (G2.13). */
function expectReloadsAsMounted(source: string): void {
	const onScreen = mounted.target.querySelectorAll(
		'[data-block-path]:not([data-block-path*=","])'
	).length;
	expect([source, parse(source).children.length]).toEqual([source, onScreen]);
}

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

describe('blockquote Enter override', () => {
	it('exits the quote on a second Enter, the created blank replacing the empty line', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		// Two `>` lines: the split's blank-line separator plus the empty paragraph it made.
		// Without the separator a line typed there would lazily continue `alpha` on reload.
		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n');
	});

	// Miss-analysis: every exit test put the quote last and checked bytes, never a reload.
	it('exits before a following block by creating the gap, not entering the block', async () => {
		mounted = mountEditor({ source: '> alpha\n\nbeta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n\nbeta\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		// Three lines, not four: the blank left behind is the separating line of the block below,
		// so a fourth reloads as an empty paragraph nobody typed.
		expect(mounted.source()).toBe('> alpha\n\n\nbeta\n');
		expectReloadsAsMounted(mounted.source());
	});

	// A table cannot hold a caret at its top edge and the quote declares no gap edge, so
	// moving down here would leave the boundary with no insertion point at all.
	it('creates the gap before a block the caret cannot open one in', async () => {
		mounted = mountEditor({ source: '> alpha\n\n| a | b |\n| - | - |\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n| a | b |\n| - | - |\n');
		expectReloadsAsMounted(mounted.source());
	});

	// One level per keypress, as the list outdent does: the first exit leaves a quoted
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

	// Without this case the exit tests would still pass if every Enter were consumed.
	it('leaves an Enter on a non-trailing child to the default split', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);

		// One new quoted blank line, not two: `beta` already carries the run's separator.
		expect(mounted.source()).toBe('> alpha\n>\n>\n> beta\n');
	});
});
