import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Which languages the highlight package answers: the default set, and every grammar opted in.
// Requirements: `e2e/requirements/blocks/code/language-set.md`.

// The picker's rows for a fence with no language, as 0.11.5 listed them.
const ROWS_0_11_5 = [
	...['text', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'html', 'java'],
	...['javascript', 'json', 'kotlin', 'latex', 'markdown', 'php', 'powershell', 'python', 'ruby'],
	...['rust', 'sql', 'swift', 'typescript', 'yaml']
];
const FENCES = '```js\nconst a = 1;\n```\n\n```nix\nlet a = 1; in a\n```\n';

const tokens = (editor: EditorPage, block: number) =>
	editor.getBlock(block).locator('[class^="code-tok-"]');

async function load(page: Page, query: '' | '?languages=all', doc: string): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto(query);
	await editor.loadContent(doc);
	return editor;
}

async function pickerRows(editor: EditorPage): Promise<string[]> {
	await editor.setPresentationMode('live');
	await editor.getBlock(0).hover();
	await editor.page.locator('.code-lang-button').click();
	await expect(editor.page.locator('.code-lang-picker input')).toBeVisible();
	return editor.page.locator('.code-lang-name').allTextContents();
}

test.describe('the highlight package by default', () => {
	test("the picker lists 0.11.5's rows, by its names and in its order", async ({ page }) => {
		const editor = await load(page, '', '```\nx\n```\n');
		expect(await pickerRows(editor)).toEqual(ROWS_0_11_5);
	});

	test('a fence in a language outside the default set stays plain', async ({ page }) => {
		const editor = await load(page, '', FENCES);
		await expect(tokens(editor, 0).first()).toBeVisible();
		await page.waitForLoadState('networkidle');
		await expect(tokens(editor, 1)).toHaveCount(0);
	});
});

test.describe('the highlight package with every grammar opted in', () => {
	test('a fence in a language outside the default set paints once its grammar lands', async ({
		page
	}) => {
		const editor = await load(page, '?languages=all', FENCES);
		await expect(tokens(editor, 1).filter({ hasText: 'let' }).first()).toBeVisible();
	});

	test('the picker lists the default rows first, then every other grammar alphabetically', async ({
		page
	}) => {
		const editor = await load(page, '?languages=all', '```\nx\n```\n');
		const rows = await pickerRows(editor);
		expect(rows.slice(0, ROWS_0_11_5.length)).toEqual(ROWS_0_11_5);
		const rest = rows.slice(ROWS_0_11_5.length);
		expect(rest).toEqual([...rest].sort());
		expect(rest).toEqual(expect.arrayContaining(['console', 'haskell', 'nix']));
	});
});
