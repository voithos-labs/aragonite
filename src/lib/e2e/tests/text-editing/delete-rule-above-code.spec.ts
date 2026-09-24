import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Deleting the rule between a paragraph and indented code: the code becomes the paragraph's
// continuation, and every other byte stays, the blank lines included.
// Requirements: `e2e/requirements/text-editing/delete-rule-above-code.md`.

for (const [label, whitespace] of [
	['two whitespace lines (#450)', '    \n    \n'],
	['three whitespace lines (#451)', '    \n    \n    \n']
] as const) {
	test(`Delete twice at the paragraph's end removes only the rule: ${label}`, async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const tail = `    code\n${whitespace}\n\`\`\`\n\`\`\`\n`;
		await editor.loadContent(`para\n***\n${tail}`);
		await editor.clickBlock(0);
		await page.keyboard.press('End');

		await page.keyboard.press('Delete');
		await page.keyboard.press('Delete');

		await expect.poll(() => editor.bridge.getSource()).toBe(`para\n${tail}`);
		expect(await editor.parseConverged()).toBe(true);
	});
}
