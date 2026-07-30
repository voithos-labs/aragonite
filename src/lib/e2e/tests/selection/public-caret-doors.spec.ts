import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The public doors a consumer can move the caret through, exercised with a
// cross-block range live (requirements/selection/public-caret-doors.md). No
// gesture-level spec reaches them: every built-in caret placement goes through a
// pointer or keyboard path that ends the range on its way in.
//
// `focus` and `setSelection` agree — both state a new caret and end the old range.
// `parkCaret` is the marked exception the cross-block dispatcher parks with while an
// extend is still growing a range.

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

	// The structural pin for the data-loss class: the caret lands at a path INSIDE the
	// live range, so a pass cannot come from the position happening to fall outside it.
	// Two whole-document deletes shipped through this exact shape before `focus` owned
	// the range-ending.
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

	// Park semantics, pinned so they cannot drift silently: `parkCaret` is the door
	// `revealActiveEndpoint` uses while an extend is still growing the range, so it
	// cannot end one. Three cross-block extend specs ride it —
	// `extend-offwindow-endpoint`, `keyboard/vertical-skip`, and
	// `cross-block-delete-container-survivor-caret`.
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
