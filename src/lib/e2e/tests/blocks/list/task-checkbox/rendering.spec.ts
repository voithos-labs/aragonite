import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';
import { computedColor, computedDecoration } from './helpers';

// GitHub's task list: a done item dims, it is not struck through.
const DONE = '.list-item-block[data-task-checked="true"] .paragraph-block';
const PENDING = '.list-item-block[data-task-checked="false"] .paragraph-block';

test.describe('task checkbox — rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a completed task dims its text and draws no strikethrough', async () => {
		await editor.loadContent('- [x] done\n- [ ] pending\n');
		expect(await computedColor(editor, DONE)).not.toBe(await computedColor(editor, PENDING));
		expect(await computedDecoration(editor, DONE)).not.toContain('line-through');
	});

	test('an unchecked task reads as the plain text around it', async () => {
		await editor.loadContent('- [ ] pending\n\nplain\n');
		const plain = "[data-block-path='[1]'] .paragraph-block";
		expect(await computedColor(editor, PENDING)).toBe(await computedColor(editor, plain));
	});

	test('nested task sub-list renders independently', async () => {
		await editor.loadContent('- [x] outer\n  - [ ] nested\n');
		// The outer paragraph is the direct child of the checked item (the dimming targets
		// that level only); the nested one lives inside a sub-list.
		const outer =
			'.list-item-block[data-task-checked="true"] > .list-item-content > .block-list > .block-host > .paragraph-block';
		expect(await computedColor(editor, outer)).not.toBe(await computedColor(editor, PENDING));
		expect(await computedDecoration(editor, outer)).not.toContain('line-through');
	});
});
