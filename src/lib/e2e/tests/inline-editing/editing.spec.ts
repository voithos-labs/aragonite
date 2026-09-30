import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const INLINE_CONTENT = `A paragraph with **bold text** and *italic text* here.

A line with \`inline code\` in it.

A line with a [link](https://example.com) present.

Plain paragraph for editing.
`;

const EDITS = [
	{ name: 'after a bold span', block: 0, at: 'end', typed: ' tail', survives: ['**bold text**'] },
	{ name: 'after a code span', block: 1, at: 'end', typed: ' more', survives: ['`inline code`'] },
	{
		name: 'before a bold span',
		block: 0,
		at: 'start',
		typed: 'Prefix: ',
		survives: ['**bold text**', '*italic text*']
	}
] as const;

test.describe('inline editing, editing formatted content', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(INLINE_CONTENT);
	});

	// A byte typed at a block edge must not reach inside the constructs already there.
	for (const { name, block, at, typed, survives } of EDITS) {
		test(`typing ${name} leaves its markers intact`, async () => {
			if (at === 'end') await editor.focusBlockEnd(block);
			else await editor.focusBlockStart(block);

			await editor.typeText(typed);
			await editor.bridge.waitForSourceContains(typed);

			const source = await editor.bridge.getSource();
			for (const marker of survives) expect(source).toContain(marker);
		});
	}

	test('typing bold in a split-created block renders strong element', async () => {
		// A block made by a split renders typed `**bold**` as a strong element, the same as a
		// block that came from the loaded source.
		await editor.loadContent('First paragraph.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('**bold**');
		await editor.bridge.waitForSourceContains('**bold**');

		const block = editor.getBlock(1);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
	});

	test('heading markers are dimmed after typing # to convert', async () => {
		// A paragraph made by a split and then turned into a heading dims its `#` marker like
		// any other heading.
		await editor.loadContent('Some text.\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('# New heading');
		await editor.bridge.waitForSourceContains('# New heading');

		const block = editor.getBlock(1);
		await expect(block.locator('.md-marker')).toHaveCount(1);
		const markerText = await block.locator('.md-marker').textContent();
		expect(markerText).toBe('# ');
	});

	test('character-by-character typing produces correct bold rendering', async () => {
		// Typing one character at a time must render the same bold as typing the whole string.
		await editor.loadContent('Hello.\n');
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' **bold**');
		await editor.bridge.waitForSourceContains('Hello. **bold**');

		const block = editor.getBlock(0);
		await expect(block.locator('strong')).toHaveCount(1);
		await expect(block.locator('strong')).toContainText('bold');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Hello. **bold**');
	});
});
