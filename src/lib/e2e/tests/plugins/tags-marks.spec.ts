import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * In-body tags the OTHER way (`routes/test/plugins/tags/tag-marks-plugin.ts`): a mark decoration
 * over ordinary text instead of an atomic inline widget. A tag's source IS its display, so there
 * is nothing for a widget's reveal to uncover — and the island a widget mints is what costs the
 * caret, the one-press Backspace and every gesture that must be taught about islands. Seed
 * `tags-marks` carries the same document as the widget battery (`tags.md`), so the two models are
 * compared on the same bytes.
 * Requirements: e2e/requirements/plugins/tags-marks.md.
 */

const chip = (editor: PluginsPage, name: string) =>
	editor.page.locator(`.body-tag-mark[data-tag="${name}"]`);

const firstLine = async (editor: PluginsPage) => (await editor.bridge.getSource()).split('\n')[0];

/** Click a fraction along the chip, which is the text beneath it. */
async function clickInsideChip(editor: PluginsPage, name: string, fraction = 0.6): Promise<void> {
	const box = await chip(editor, name).boundingBox();
	if (!box) throw new Error(`no chip for #${name}`);
	await editor.page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
	await editor.waitForRenderFlush();
}

test.describe('in-body tags as mark decorations', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('tags-marks');
	});

	test('every tag paints a chip, and the document holds no island', async () => {
		await expect(editor.page.locator('.body-tag-mark')).toHaveCount(4);
		await expect(chip(editor, 'work/admin')).toHaveCount(1);
		// The whole point of this model: nothing here is `contenteditable=false`.
		await expect(editor.page.locator('[data-inline-widget]')).toHaveCount(0);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('the caret lands INSIDE a tag, where a widget would have made an island', async () => {
		await clickInsideChip(editor, 'project');
		const focus = (await editor.bridge.getSelectionPaths())?.focus;
		// `Filed under #project` — the tag's bytes run 12..20, and the caret sits among them.
		expect(focus?.path).toEqual([0]);
		expect(focus!.offset).toBeGreaterThan(12);
		expect(focus!.offset).toBeLessThan(20);
	});

	test('one Backspace takes one character, and the chip follows the bytes', async () => {
		await clickInsideChip(editor, 'project');
		const before = await firstLine(editor);

		await editor.page.keyboard.press('Backspace');

		// One byte, not the whole construct: a widget's edge would have taken the tag entire.
		await expect.poll(async () => (await firstLine(editor)).length).toBe(before.length - 1);
		// Still a tag, still one chip on that line, with no reveal in between.
		await expect(editor.page.locator('[data-block-path="[0]"] .body-tag-mark')).toHaveCount(2);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('typing inside a tag extends it, with no reveal and no remount', async () => {
		await clickInsideChip(editor, 'project');

		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('#proXject');

		await expect(chip(editor, 'proXject')).toHaveCount(1);
		await expect(editor.page.locator('[data-inline-widget]')).toHaveCount(0);
	});

	test('a selection grows through a tag one character at a time', async () => {
		await clickInsideChip(editor, 'project', 0.1);
		for (let step = 0; step < 4; step++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.waitForRenderFlush();

		// Four presses, four characters: the tag is text, so nothing steps over it whole.
		const selected = await editor.page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected).toHaveLength(4);
	});

	test('a tag opening a line is a paragraph, painted at paragraph size', async () => {
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await expect(chip(editor, 'inbox')).toHaveCount(1);
		const sizes = await editor.page.evaluate(() => {
			const size = (index: number) => {
				const el = document.querySelector(`[data-block-path='[${index}]'] [contenteditable]`);
				return el ? parseFloat(getComputedStyle(el).fontSize) : null;
			};
			return { tagLine: size(1), prose: size(3) };
		});
		expect(sizes.tagLine).toBe(sizes.prose);
	});

	test('an edit earlier in the line moves the chip with the text', async () => {
		const before = await chip(editor, 'project').boundingBox();
		await editor.focusBlockStart(0);
		await editor.typeText('Now ');
		await editor.bridge.waitForSourceContains('Now Filed');

		const after = await chip(editor, 'project').boundingBox();
		expect(after!.x).toBeGreaterThan(before!.x);
		await expect(chip(editor, 'project')).toHaveCount(1);
	});

	test('a tag typed live paints as soon as its name lands', async () => {
		await editor.focusBlockEnd(3);
		await editor.typeText(' #fresh');
		await editor.bridge.waitForSourceContains('#fresh');
		await expect(chip(editor, 'fresh')).toHaveCount(1);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});
});
