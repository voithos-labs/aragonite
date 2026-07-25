// @vitest-environment jsdom
//
// The task checkbox is a click target inside the item's ambient marker span — a
// contenteditable="false" island, not a real input. Its handler is built by
// `buildTaskItemAmbient` (unit tested against metadata) but SUPPLIED by ListItemBlock
// as `toggleTask`, which carries the three rules the builder knows nothing about: the
// reading-mode gate, the cross-block-selection clear, and the paired metadata write.
// Only a mounted item connects the rendered span to those rules.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, blockHostAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

// A list item renders no BlockHost of its own (its `.list-item-block` box IS the
// slot its parent list measures), so items are addressed by position within the list.
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

	// Reading mode keeps the checkbox VISIBLE but inert — the toggle is a document
	// edit, and reading mode commits nothing. CSS also drops the pointer affordance,
	// but the guard has to hold on its own: a synthetic click bypasses CSS entirely.
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
