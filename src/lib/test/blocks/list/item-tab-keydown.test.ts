// @vitest-environment jsdom
// Tab inside a list takes two steps: the paragraph's `block.insertTab` declines without
// `preventDefault` under a list context, and the event bubbles to `.list-item-content`, where
// ListItemBlock resolves it against the listItem keymap. Either step breaking stops indenting
// with no other sign.
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

const TAB = { key: 'Tab' };
const SHIFT_TAB = { key: 'Tab', shiftKey: true };

describe('list item Tab dispatch', () => {
	it('indents the item on Tab, nesting it under its predecessor', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n  - beta\n');
	});

	it('unindents a nested item on Shift+Tab', async () => {
		mounted = mountEditor({ source: '- alpha\n  - beta\n' });

		await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, SHIFT_TAB);

		expect(mounted.source()).toBe('- alpha\n- beta\n');
	});

	// The first item has no predecessor to nest under, so the command runs and
	// changes nothing rather than corrupting the list.
	it('leaves the first item alone on Tab', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		await pressKeyAt(mounted, [0, 0, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n- beta\n');
	});

	// Reading mode renders the same element with only `contenteditable` changed, so the key still
	// arrives and only the dispatcher's mode check stops the indent.
	it('does not indent in reading mode', async () => {
		mounted = mountEditor({ source: '- alpha\n- beta\n', presentationMode: 'reading' });
		const itemContent = mounted.target.querySelectorAll('.list-item-content')[1];
		let reachedItemHandler = false;
		itemContent.addEventListener('keydown', () => (reachedItemHandler = true));

		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(reachedItemHandler).toBe(true);
		expect(mounted.source()).toBe('- alpha\n- beta\n');
	});

	// Miss-analysis: the single edit event of an unindent was only counted in a browser, so a second
	// commit in the promote path passed every unit row.
	it.each([
		['Tab', '- alpha\n- beta\n', [0, 1, 0], TAB],
		['Shift+Tab', '- alpha\n  - beta\n', [0, 0, 1, 0, 0], SHIFT_TAB]
	] as const)('%s emits exactly one edit event', async (_, source, path, key) => {
		mounted = mountEditor({ source });
		const edits: string[] = [];
		mounted.instance.getEvents().on('edit', (e) => edits.push(e.op));

		await pressKeyAt(mounted, [...path], 0, key);

		expect(mounted.source()).not.toBe(source);
		expect(edits).toHaveLength(1);
	});

	// Miss-analysis: every override row drove a leaf block, so none saw the list item's own key
	// handler, which resolves Tab against the overrides as the key travels up.
	it.each([
		['a global disable', [{ chord: 'Tab', command: null }]],
		['a listItem-scoped disable', [{ chord: 'Tab', command: null, kind: 'listItem' }]]
	] as const)('%s stops the indent', async (_, keybindings) => {
		mounted = mountEditor({ source: '- alpha\n- beta\n', keybindings: [...keybindings] });

		await pressKeyAt(mounted, [0, 1, 0], 0, TAB);

		expect(mounted.source()).toBe('- alpha\n- beta\n');
	});
});
