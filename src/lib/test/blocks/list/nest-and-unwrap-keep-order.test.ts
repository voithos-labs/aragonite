// @vitest-environment jsdom
// Tab nests an item at the end of the item above, and Backspace at a list's first item unwraps it
// with its children in the order they read, so neither move changes the document's order.
// Miss-analysis: every nest fixture gave the item above one sublist and nothing after it, and every
// unwrap fixture gave the first item a sublist only, so nothing held a paragraph after a sublist.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

describe('Tab nests an item at the end of the item above', () => {
	it('after a paragraph that follows the sublist above', async () => {
		mounted = mountEditor({ source: '- alpha\n  - x\n\n  more\n- beta\n' });
		await pressKeyAt(mounted, [0, 1, 0], 0, { key: 'Tab' });

		expect(mounted.source()).toBe('- alpha\n  - x\n\n  more\n  - beta\n');
	});
});

describe('Backspace at the first item of a list keeps the order its children read in', () => {
	it('a paragraph after the sublist stays after it', async () => {
		mounted = mountEditor({ source: '- a\n  - x\n\n  more\n- b\n' });
		await pressKeyAt(mounted, [0, 0, 0], 0, { key: 'Backspace' });

		expect(mounted.source()).toBe('a\n- x\n\nmore\n- b\n');
	});

	it('two paragraphs of the item stay two paragraphs', async () => {
		mounted = mountEditor({ source: '- a\n\n  more\n- b\n' });
		await pressKeyAt(mounted, [0, 0, 0], 0, { key: 'Backspace' });

		expect(mounted.source()).toBe('a\n\nmore\n- b\n');
	});

	// An ordered list can interrupt a paragraph only when it starts at 1.
	it('a list that starts past 1 gets a blank line under the paragraph', async () => {
		mounted = mountEditor({ source: '3. a\n   1. x\n4. b\n' });
		await pressKeyAt(mounted, [0, 0, 0], 0, { key: 'Backspace' });

		expect(mounted.source()).toBe('a\n\n3. x\n4. b\n');
	});
});
