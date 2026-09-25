// @vitest-environment jsdom
//
// The task checkbox is a click target inside the item's marker span, a contenteditable="false"
// element rather than a real input. Its handler is built by `buildTaskItemAmbient` but supplied
// by ListItemBlock as `toggleTask`, carrying three rules the builder knows nothing about: the
// reading-mode check, clearing a cross-block selection, and the paired metadata write. Only a
// mounted item connects the rendered span to those rules.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	blockHostAt,
	pressKeyAt
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

// A list item renders no BlockHost of its own, since its `.list-item-block` box is what the
// parent list measures, so items are addressed by position within the list.
function checkbox(at: ReturnType<typeof mountEditor>, itemIndex: number): HTMLElement {
	const item = blockHostAt(at, [0]).querySelectorAll<HTMLElement>(
		':scope > .list-block > .list-item-block'
	)[itemIndex];
	const el = item?.querySelector<HTMLElement>('.task-checkbox');
	if (!el) throw new Error(`no task checkbox in list item ${itemIndex}`);
	return el;
}

async function clickCheckbox(at: ReturnType<typeof mountEditor>, itemIndex: number): Promise<void> {
	checkbox(at, itemIndex).dispatchEvent(new MouseEvent('click', { bubbles: true }));
	await at.settle();
}

describe('list item task checkbox', () => {
	it('writes the checked marker into the source on click', async () => {
		mounted = mountEditor({ source: '- [ ] todo\n' });

		await clickCheckbox(mounted, 0);

		expect(mounted.source()).toBe('- [x] todo\n');
	});

	it('toggles back off on a second click', async () => {
		mounted = mountEditor({ source: '- [x] done\n' });

		await clickCheckbox(mounted, 0);

		expect(mounted.source()).toBe('- [ ] done\n');
	});

	it('reports its state to assistive tech from the rendered marker', () => {
		mounted = mountEditor({ source: '- [ ] todo\n- [x] done\n' });

		expect(checkbox(mounted, 0).getAttribute('role')).toBe('checkbox');
		expect(checkbox(mounted, 0).getAttribute('aria-checked')).toBe('false');
		expect(checkbox(mounted, 1).getAttribute('aria-checked')).toBe('true');
	});

	// Reading mode keeps the checkbox visible but inert. CSS also removes the pointer cursor,
	// but the check has to hold on its own, since a synthetic click bypasses CSS entirely.
	it('stays inert in reading mode', async () => {
		mounted = mountEditor({ source: '- [ ] todo\n', presentationMode: 'reading' });

		await clickCheckbox(mounted, 0);

		expect(mounted.source()).toBe('- [ ] todo\n');
	});

	// Both directions: a handler that always targeted index 0 would pass the first
	// case alone.
	it('toggles only the item whose box was clicked', async () => {
		mounted = mountEditor({ source: '- [ ] one\n- [ ] two\n' });

		await clickCheckbox(mounted, 0);

		expect(mounted.source()).toBe('- [x] one\n- [ ] two\n');
	});

	it('toggles the second item when its own box is clicked', async () => {
		mounted = mountEditor({ source: '- [ ] one\n- [ ] two\n' });

		await clickCheckbox(mounted, 1);

		expect(mounted.source()).toBe('- [ ] one\n- [x] two\n');
	});
});

// The keyboard route to the same toggle: the chord bubbles from the item's paragraph to the
// item's own keydown handler, so a regression at either step shows here.
describe('list item task toggle on Mod+Enter', () => {
	const MOD_ENTER = { key: 'Enter', ctrlKey: true };

	it('toggles the box of the item holding the caret', async () => {
		mounted = mountEditor({ source: '- [ ] one\n- [ ] two\n' });

		const event = await pressKeyAt(mounted, [0, 1, 0], 0, MOD_ENTER);

		expect(event.defaultPrevented).toBe(true);
		expect(mounted.source()).toBe('- [ ] one\n- [x] two\n');
	});

	it('declines on a plain item, leaving the key unclaimed', async () => {
		mounted = mountEditor({ source: '- one\n' });

		const event = await pressKeyAt(mounted, [0, 0, 0], 0, MOD_ENTER);

		expect(event.defaultPrevented).toBe(false);
		expect(mounted.source()).toBe('- one\n');
	});

	// The key bubbles through every enclosing item, so a declining child must not hand the
	// toggle to the task item it sits in.
	it('leaves an enclosing task alone when the caret is in a plain child item', async () => {
		mounted = mountEditor({ source: '- [ ] parent\n  - child\n' });

		const event = await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, MOD_ENTER);

		expect(event.defaultPrevented).toBe(false);
		expect(mounted.source()).toBe('- [ ] parent\n  - child\n');
	});

	it('declines in reading mode', async () => {
		mounted = mountEditor({ source: '- [ ] one\n', presentationMode: 'reading' });

		const event = await pressKeyAt(mounted, [0, 0, 0], 0, MOD_ENTER);

		expect(event.defaultPrevented).toBe(false);
		expect(mounted.source()).toBe('- [ ] one\n');
	});
});
