// @vitest-environment jsdom
//
// ListItemBlock's `splitBlock` override routes Enter inside a list: it reads the item's shape
// and picks one of three ListContext members. The helpers are unit tested; the ROUTING is not,
// and `exitListAtItem` has no coverage at any level. Each branch lands different bytes, so the
// real keystroke tells them apart without a spy — the routing is asserted by the document.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

describe('list item Enter routing', () => {
	it('appends a sibling item when the caret is at the end of the item', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);

		expect(mounted.source()).toBe('- alpha\n- \n- beta\n');
	});

	it('splits the item at the caret when the caret is mid-content', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		await pressKeyAt(mounted, [0, 0, 0], 2, ENTER);

		expect(mounted.source()).toBe('- al\n- pha\n- beta\n');
	});

	// The empty-item arm, and the only route into `exitListAtItem`. An empty item that can hold a
	// caret only exists after the append above, so the two presses are the real user gesture.
	it('exits the list on a second Enter in the item the first one appended', async () => {
		mounted = mountEditor({ source: '- alpha\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, ENTER);

		expect(mounted.source()).toBe('- alpha\n\n\n');
	});

	// `isAtEnd` needs BOTH the last inner child and the end of its text: an item carrying a nested
	// sub-list has the caret in child 0 with a child 1 behind it.
	it('splits rather than appends at the end of a non-final child', async () => {
		mounted = mountEditor({ source: '- alpha\n  - nested\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);

		expect(mounted.source()).toBe('- alpha\n- \n  - nested\n');
	});
});

// Miss-analysis: the Enter-completion suite asserted the top-level and blockquote seams only, and
// the routing suite above asserted the item's three arms only, so nothing asserted the item as an
// Enter path that owes the completion consult — the sibling-parity class, one entry path short.
describe('list item Enter completion (#146)', () => {
	it('completes a header row typed in an item instead of appending a sibling', async () => {
		mounted = mountEditor({ source: '- | a | b |\n' });

		await pressKeyAt(mounted, [0, 0, 0], 9, ENTER);

		expect(mounted.source()).toBe('- | a | b |\n  | --- | --- |\n  |  |  |\n');
		expect(parse(mounted.source()).children[0].children![0].children!.map((c) => c.kind)).toEqual([
			'table'
		]);
	});

	// Complete-wins takes only the claimed line: an item whose text no completer claims still
	// reaches the three arms above, which is what keeps Enter in a list a list gesture.
	it('leaves an unclaimed line to the item’s own arms', async () => {
		mounted = mountEditor({ source: '- | a |\n' });

		await pressKeyAt(mounted, [0, 0, 0], 7, ENTER);

		expect(mounted.source()).toBe('- | a |\n- \n');
	});
});
