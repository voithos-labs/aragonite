// @vitest-environment jsdom
//
// Tab inside a list is dispatched in two steps: the focused paragraph's `block.insertTab`
// declines, without calling `preventDefault`, when a list context is present, the event bubbles
// to `.list-item-content`, and ListItemBlock resolves it against the listItem keymap. Either step
// breaking stops indenting with no other sign. The reading-mode case pins that the item hands
// the dispatcher its mode getter, which is what refuses the key there.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '$lib/test/harness/mount-editor.svelte';

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
});
