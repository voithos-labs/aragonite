import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The two public doors a consumer can move the caret through, exercised with a
// cross-block range live (requirements/selection/public-caret-doors.md). No
// gesture-level spec reaches them: every built-in caret placement goes through a
// pointer or keyboard path that ends the range on its way in.
//
// They are deliberately different, and the difference is the contract:
// `BlockComponent.focus` parks a caret and leaves the range alone — the cross-block
// dispatcher itself parks that way mid-extend — while `setSelection` states a new
// selection and ends the old one. A consumer moving the caret because the USER acted
// wants the second door.

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

	// Park semantics, pinned so they cannot drift silently: `focus` is the primitive
	// `revealActiveEndpoint` parks the dispatch caret with while an extend is still
	// growing the range, so it cannot end one. Seating the range-ending here was
	// tried and reverted — it reds three cross-block extend specs.
	test('BlockComponent.focus parks the caret and leaves the range live', async () => {
		const parked = await editor.page.evaluate(() =>
			(
				window as unknown as {
					__test: { focusBlockComponent(path: number[], offset: number): boolean };
				}
			).__test.focusBlockComponent([1], 3)
		);
		expect(parked).toBe(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});
});
