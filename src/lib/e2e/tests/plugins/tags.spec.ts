import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, capturedErrors } from './helpers';

/**
 * In-body `#tag` as a plugin inline widget, limestone's own integration reproduced in the harness
 * (`routes/test/plugins/tags`): a bare `#` trigger, a widget that paints the tag, `revealSource`
 * for editing and `claimsActivationClick` for navigation. Seed `tags`: a tag mid-prose and a
 * nested one in block 0, a tag opening block 1 (the case the heading opener contests), a tag
 * inside a heading's content in block 2, and a plain typing target in block 3.
 * Requirements: e2e/requirements/plugins/tags.md.
 */

const tagChip = (editor: PluginsPage, name: string) =>
	editor.page.locator(`.body-tag[data-tag="${name}"]`);

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');

/** A real press-move-release across the glyph, stepped so the drag session sees several moves. */
async function dragFromTag(editor: PluginsPage, name: string, toX: (left: number) => number) {
	const box = await tagChip(editor, name).boundingBox();
	if (!box) throw new Error(`no box for #${name}`);
	const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const target = toX(box.x);
	await editor.page.mouse.move(from.x, from.y);
	await editor.page.mouse.down();
	for (let step = 1; step <= 6; step++) {
		await editor.page.mouse.move(from.x + ((target - from.x) * step) / 6, from.y);
	}
	await editor.page.mouse.up();
	await editor.waitForRenderFlush();
}

test.describe('in-body tags as inline widgets', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('tags');
	});

	test('the seed renders every tag and keeps its bytes', async () => {
		await expect(editor.page.locator('.body-tag')).toHaveCount(4);
		await expect(tagChip(editor, 'project')).toHaveText('#project');
		await expect(tagChip(editor, 'work/admin')).toHaveText('#work/admin');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Filed under #project and #work/admin today');
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	// The block opener owns `#` at a line's start, and a bare `#` is CommonMark's empty heading:
	// a tag opening a line must stay prose, at prose size, or every to-do tag reads as a title.
	test('a tag opening a line is a paragraph, painted at paragraph size', async () => {
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await expect(tagChip(editor, 'inbox')).toHaveCount(1);
		const sizes = await editor.page.evaluate(() => {
			const size = (index: number) => {
				const el = document.querySelector(`[data-block-path='[${index}]'] [contenteditable]`);
				return el ? parseFloat(getComputedStyle(el).fontSize) : null;
			};
			return { tagLine: size(1), prose: size(3) };
		});
		expect(sizes.tagLine).toBe(sizes.prose);
	});

	test('a heading keeps its kind and still renders a tag in its content', async () => {
		expect(await editor.bridge.getBlockKind(2)).toBe('heading');
		await expect(tagChip(editor, 'tag')).toHaveCount(1);
	});

	test('a tag typed live renders once its name lands', async () => {
		await editor.focusBlockEnd(3);
		await editor.typeText(' #fresh');
		await editor.bridge.waitForSourceContains('#fresh');
		await expect(tagChip(editor, 'fresh')).toHaveCount(1);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('a bare `#`, an all-digit name and a mid-word hash are not tags', async () => {
		await editor.focusBlockEnd(3);
		await editor.typeText(' # #123 C#sharp');
		await editor.bridge.waitForSourceContains('C#sharp');
		// Four from the seed and not one more: none of the three shapes above is a tag.
		await expect(editor.page.locator('.body-tag')).toHaveCount(4);
	});

	test('a drag that starts on a tag selects, and reveals nothing', async () => {
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
		const before = await editor.bridge.getSource();

		await dragFromTag(editor, 'project', (left) => left + 260);

		expect(await selectedText(editor.page)).toContain('work/admin');
		// The release travelled, so it is a drag's end, not the click that reveals: the chip stands.
		await expect(tagChip(editor, 'project')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe(before);
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('a drag leftward from a tag selects the text before it', async () => {
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();

		await dragFromTag(editor, 'project', (left) => left - 200);

		expect(await selectedText(editor.page)).toContain('Filed under');
		await expect(tagChip(editor, 'project')).toHaveCount(1);
	});

	test('a click on a tag reveals its source; the chip returns on blur', async () => {
		await editor.setPresentationMode('live');
		await editor.waitForRenderFlush();
		const box = await tagChip(editor, 'project').boundingBox();
		if (!box) throw new Error('no chip box');

		await editor.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await editor.waitForRenderFlush();
		await expect(tagChip(editor, 'project')).toHaveCount(0);

		await editor.clickBlock(3);
		await editor.waitForRenderFlush();
		await expect(tagChip(editor, 'project')).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('#project');
	});

	test('Ctrl-click is the activation gesture the host navigates on', async ({ page }) => {
		await page.evaluate(
			() => ((window as never as { __tagActivations: string[] }).__tagActivations = [])
		);
		const box = await tagChip(editor, 'inbox').boundingBox();
		if (!box) throw new Error('no chip box');

		await page.keyboard.down('Control');
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.keyboard.up('Control');
		await editor.waitForRenderFlush();

		expect(
			await page.evaluate(
				() => (window as never as { __tagActivations: string[] }).__tagActivations
			)
		).toEqual(['inbox']);
	});
});
