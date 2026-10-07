import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { textRunCenter } from '../../text-runs';
import { nextRow } from '../presentation/helpers';

// An edit key over a whole-block range whose first inline node is a widget the caret cannot
// enter (`requirements/selection/widget-led-range-edit.md`). The range is what the key edits;
// the construct beside its start is not.

const MATH_LINE = '$x^2$ opens this line\n';
const GLYPH_LINE = ':smile: opens this line\n';

async function selectWholeBlock(
	editor: PluginsPage,
	page: import('@playwright/test').Page,
	rung: 'ctrl-a' | 'triple-click'
): Promise<void> {
	if (rung === 'ctrl-a') {
		await editor.focusBlockStart(0);
		await editor.selectAll();
		return;
	}
	const at = await textRunCenter(page, 'opens');
	await page.mouse.click(at.x, at.y, { clickCount: 3 });
}

test.describe('editing a whole-block range that opens with a widget', () => {
	for (const mode of ['source', 'live'] as const) {
		test(`${mode} mode: a formula-led block`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('math');
			await editor.setPresentationMode(mode);

			for (const rung of ['ctrl-a', 'triple-click'] as const) {
				await test.step(`a character typed over the ${rung} range replaces the block`, async () => {
					await nextRow(editor, MATH_LINE);
					await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
					await selectWholeBlock(editor, page, rung);
					await page.keyboard.type('X');

					await editor.bridge.waitForSourceEquals('X\n');
					expect(await editor.bridge.getSource()).toBe('X\n');

					// One undo restores the bytes whole: the replacement was a single commit.
					await editor.waitForUndoBatchFlush();
					await editor.undo();
					await editor.bridge.waitForSourceEquals(MATH_LINE);
				});
			}

			await test.step('Delete over the range empties the block, never just the widget', async () => {
				await nextRow(editor, MATH_LINE);
				await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
				await selectWholeBlock(editor, page, 'ctrl-a');
				await page.keyboard.press('Delete');

				await editor.bridge.waitForSourceEquals('\n');
				expect(await editor.bridge.getSource()).toBe('\n');
			});
		});
	}
});

// The glyph kind deletes whole at a caret, the rule the range has to override.
test.describe('editing a whole-block range that opens with a glyph', () => {
	for (const mode of ['source', 'live'] as const) {
		test(`${mode} mode: a glyph-led block`, async ({ page }) => {
			const editor = new PluginsPage(page);
			await editor.gotoPlugins('emoji');
			await editor.setPresentationMode(mode);

			await test.step('a character typed over the range replaces the block', async () => {
				await nextRow(editor, GLYPH_LINE);
				await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
				await selectWholeBlock(editor, page, 'ctrl-a');
				await page.keyboard.type('X');

				await editor.bridge.waitForSourceEquals('X\n');
				expect(await editor.bridge.getSource()).toBe('X\n');
			});

			await test.step('Delete over the range empties the block', async () => {
				await nextRow(editor, GLYPH_LINE);
				await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
				await selectWholeBlock(editor, page, 'ctrl-a');
				await page.keyboard.press('Delete');

				await editor.bridge.waitForSourceEquals('\n');
				expect(await editor.bridge.getSource()).toBe('\n');
			});
		});
	}
});
