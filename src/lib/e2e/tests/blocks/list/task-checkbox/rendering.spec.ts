import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { computedDecoration } from './helpers';

test.describe('task checkbox — rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('completed task renders with strikethrough', async () => {
		await editor.loadContent('- [x] done\n');
		const deco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="true"] .paragraph-block'
		);
		expect(deco).toContain('line-through');
	});

	test('unchecked task does not have strikethrough', async () => {
		await editor.loadContent('- [ ] pending\n');
		const deco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="false"] .paragraph-block'
		);
		expect(deco).not.toContain('line-through');
	});

	test('nested task sub-list renders independently', async () => {
		await editor.loadContent('- [x] outer\n  - [ ] nested\n');
		// Outer paragraph is the direct child of the checked item (strikethrough
		// targets that level only). Nested paragraph lives inside a sub-list.
		const outerDeco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="true"] > .list-item-content > .block-list > .block-host > .paragraph-block'
		);
		const nestedDeco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="false"] .paragraph-block'
		);
		expect(outerDeco).toContain('line-through');
		expect(nestedDeco).not.toContain('line-through');
	});
});
