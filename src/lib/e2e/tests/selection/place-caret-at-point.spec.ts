import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The public caret door, driven through the bridge the way a host shell answering a click on
// its own chrome calls it (requirements/selection/place-caret-at-point.md). No mouse: the
// point is a number pair the shell read off its own element, which is the whole contract.

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

test.describe('placeCaretAtPoint is the host shell’s caret door', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const placeAt = (x: number, y: number): Promise<boolean> =>
		editor.page.evaluate((p) => (window as any).__test.placeCaretAtPoint(p.x, p.y) as boolean, {
			x,
			y
		});

	const rootBox = () =>
		editor.page.evaluate(() => {
			const r = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
			return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
		}) as Promise<Box>;

	async function blockBox(index: number): Promise<Box> {
		const r = await editor.getBlock(index).boundingBox();
		if (!r) throw new Error(`no box for block ${index}`);
		return { left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
	}

	// Below the editor box entirely — the shell's own territory, a point no click on the
	// editor could produce, which is what makes this the method's reason to exist.
	test('a point below the whole editor lands the caret at the document end', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const root = await rootBox();

		expect(await placeAt(root.left + 40, root.bottom + 200)).toBe(true);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('first para\n\nsecond para!');
	});

	test('a point beside a line lands the caret at the end of that line', async () => {
		// Long enough to wrap, so "end of that line" and "end of the block" differ.
		await editor.loadContent(`${'alpha '.repeat(60).trim()}\n`);
		const root = await rootBox();
		const para = await blockBox(0);

		expect(await placeAt(root.right - 5, para.top + 6)).toBe(true);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		const source = await editor.bridge.getSource();
		expect(source.trim().endsWith('!')).toBe(false);
	});

	// Not dead-space-only: the shell's decision to call is the gate, so a point over the
	// text resolves there like any other.
	test('a point over a block’s own text lands the caret in it', async () => {
		await editor.loadContent('first para\n\nsecond para\n');
		const para = await blockBox(0);

		expect(await placeAt(para.left + 2, para.top + 6)).toBe(true);
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains('!');

		expect((await editor.bridge.getSource()).trim()).toBe('!first para\n\nsecond para');
	});

	// A false answer is what lets the shell do something else with the click.
	test('a point resolving nothing focusable returns false and focuses no block', async () => {
		await editor.loadContent('lead\n\n---\n');
		const root = await rootBox();

		expect(await placeAt(root.left + 40, root.bottom + 200)).toBe(false);

		const focusedKind = await editor.page.evaluate(
			() =>
				(document.activeElement as HTMLElement | null)
					?.closest('[data-block-kind]')
					?.getAttribute('data-block-kind') ?? 'none'
		);
		expect(focusedKind).toBe('none');
	});

	// The G2.12 shape: a caret placed while a cross-block range stays live leaves the range
	// painted over it, and the next printable key type-replaces the whole document.
	test('the landing ends a live cross-block range', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.waitForCrossBlock(true);

		const root = await rootBox();
		expect(await placeAt(root.left + 40, root.bottom + 200)).toBe(true);

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');
		const source = await editor.bridge.getSource();
		expect(source, 'the stale range type-replaced the document away').toContain('first para');
		expect(source.trim()).toBe('first para\n\nsecond para\n\nthird paraX');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});
});
