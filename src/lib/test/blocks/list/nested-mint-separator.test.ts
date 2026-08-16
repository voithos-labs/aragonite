// @vitest-environment jsdom
//
// Enter then Tab mints an empty item and nests it, and `- x\n  - ` is the one shape strict GFM
// cannot read back: the marker line is a setext underline everywhere the bytes travel, so the
// mint emits the blank separating line, at the cost of a loose item.
//
// Miss-analysis: the Tab suite moved content-bearing items only and the Enter suite never
// pressed Tab after it, so the pair that reaches the shape was asserted by neither.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { assertParseConverged } from '$lib/testing/parse-convergence';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };
const TAB = { key: 'Tab' };
const SHIFT_TAB = { key: 'Tab', shiftKey: true };

describe('Enter then Tab mints a readable sublist', () => {
	it('separates the empty nested item from the paragraph above it', async () => {
		mounted = mountEditor({ source: '- alpha\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n\n  - \n');
		assertParseConverged(parse(mounted.source()));
	});

	it('the tree the editor shows survives its own bytes', async () => {
		mounted = mountEditor({ source: '- alpha\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		const item = parse(mounted.source()).children[0].children![0];
		expect(item.children!.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		expect(item.children![1].children).toHaveLength(1);
	});

	it('Shift+Tab converges back on the sibling item', async () => {
		mounted = mountEditor({ source: '- alpha\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);
		await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, SHIFT_TAB);

		expect(mounted.source()).toBe('- alpha\n- \n');
	});

	// The separating line is a line ending like any other (G4.20): a lone LF here would
	// strand one inside a CRLF document.
	it('takes the document’s line ending', async () => {
		mounted = mountEditor({ source: '- alpha\r\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\r\n\r\n  - \r\n');
	});

	// The control: a marker with content interrupts a paragraph on its own, so nesting it
	// owes no line and the list stays tight.
	it('a content-bearing item nests with no separating line', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n  - beta\n');
	});

	it('an ordered empty item takes the same line', async () => {
		mounted = mountEditor({ source: '1. alpha\n' });

		await pressKeyAt(mounted, [0, 0, 0], 5, ENTER);
		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('1. alpha\n\n   1. \n');
	});

	// The cadence the simulation's deep-nesting notes build with, one level in: the line the
	// mint owes is a property of the item it lands in, not of the document's top level.
	it('mints the line at depth too', async () => {
		mounted = mountEditor({ source: '- alpha\n  - beta\n' });

		await pressKeyAt(mounted, [0, 0, 1, 0, 0], 4, ENTER);
		await pressKeyAt(mounted, [0, 0, 1, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n  - beta\n\n    - \n');
		assertParseConverged(parse(mounted.source()));
	});
});
