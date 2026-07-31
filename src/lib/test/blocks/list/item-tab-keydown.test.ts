// @vitest-environment jsdom
//
// Tab inside a list is a two-hop dispatch: the focused paragraph's `block.insertTab` DECLINES
// (without preventDefault) when a listContext is present, the event bubbles to
// `.list-item-content`, and ListItemBlock resolves it against the listItem keymap. Either hop
// breaking stops indenting with no other symptom. The reading-mode arm is this component's own
// G4.19 obligation: the caller hands the dispatcher no `getPresentationMode`, so the seam's gate
// cannot dead-key it and `handleKeydown` carries a local `readOnly` guard instead.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

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

	// G4.19, local-guard arm: reading mode renders the SAME surface (only `contenteditable` flips),
	// so the key still arrives; without the local guard this indents — the dispatcher has no mode.
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
