import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The public caret doors, exercised with a cross-block range LIVE
// (requirements/selection/public-caret-doors.md). No gesture-level spec reaches them: every
// built-in placement goes through a path that ends the range on its way in. `focus` and
// `setSelection` both end the old range; `parkCaret` is the marked exception the cross-block
// dispatcher uses while an extend is still growing one.

test.describe('public caret doors with a cross-block range live', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
	});

	test('setSelection ends the range, so the next keystroke replaces nothing', async () => {
		await editor.bridge.setSelection({
			anchor: { path: [1], offset: 3 },
			focus: { path: [1], offset: 3 }
		});
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		expect(source).toContain('first para');
		expect(source).toContain('third para');
	});

	// The caret lands at a path INSIDE the live range, so a pass cannot come from the position
	// happening to fall outside it — the shape two whole-document deletes shipped through.
	test('BlockComponent.focus ends the range, so the next keystroke replaces nothing', async () => {
		const placed = await editor.page.evaluate(() =>
			(
				window as unknown as {
					__test: { focusBlockComponent(path: number[], offset: number): boolean };
				}
			).__test.focusBlockComponent([1], 3)
		);
		expect(placed).toBe(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('X');

		const source = await editor.bridge.getSource();
		expect(source).toContain('first para');
		expect(source).toContain('third para');
	});

	// `parkCaret` is the door `revealActiveEndpoint` uses while an extend is still growing the
	// range, so it must NOT end one. Ridden by `extend-offwindow-endpoint`,
	// `keyboard/vertical-skip`, and `cross-block-delete-container-survivor-caret`.
	test('BlockComponent.parkCaret leaves the range live', async () => {
		const parked = await editor.page.evaluate(() =>
			(
				window as unknown as {
					__test: { parkCaretInBlockComponent(path: number[], offset: number): boolean };
				}
			).__test.parkCaretInBlockComponent([1], 3)
		);
		expect(parked).toBe(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
