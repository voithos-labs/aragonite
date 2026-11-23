import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { PluginsPage } from '../../plugins/helpers';

// What the language picker's Enter writes: the row it visibly marks, else the text as typed.
// Requirements: `e2e/requirements/blocks/code/picker-enter.md`.

// Typed, then what the picker marks (null for nothing) and what Enter writes after the opener.
type Row = [typed: string, marked: string | null, writes: string];

const BOTH: Row[] = [
	['python', 'python', 'python'],
	['pyth', 'python', 'python'],
	['py', 'python', 'py'],
	['c', 'c', 'c'],
	['sh', 'bash', 'sh'],
	['ts', 'typescript', 'ts'],
	['js', 'javascript', 'js'],
	['java', 'java', 'java'],
	['asm', null, 'asm'],
	['sol', null, 'sol'],
	['conf', null, 'conf'],
	['log', null, 'log'],
	['zzlang', null, 'zzlang'],
	// javascript and typescript only contain it, so they stay listed but unmarked.
	['script', null, 'script']
];
const INSTALLS: { name: string; query: '' | '?languages=all'; rows: Row[] }[] = [
	{
		name: 'by default',
		query: '',
		rows: [...BOTH, ['r', 'ruby', 'ruby'], ['x', null, 'x'], ['math', null, 'math']]
	},
	{
		name: 'with every grammar opted in',
		query: '?languages=all',
		// `x` starts axapta's alias `x++`, and `math` starts mathematica.
		rows: [
			...BOTH,
			['r', 'r', 'r'],
			['x', 'axapta', 'axapta'],
			['math', 'mathematica', 'mathematica']
		]
	}
];

const marked = (page: Page) => page.locator('.code-lang-list [data-active="true"] .code-lang-name');
const opener = (page: Page) =>
	page.evaluate(() => ((window as any).__test.getSource() as string).split('\n')[0]);

async function openPicker(page: Page, query: '' | '?languages=all'): Promise<void> {
	const editor = new EditorPage(page);
	await editor.goto(query);
	await editor.loadContent('```\nx\n```\n');
	await editor.setPresentationMode('live');
	await editor.getBlock(0).hover();
	await page.locator('.code-lang-button').click();
	await expect(page.locator('.code-lang-picker input')).toBeVisible();
}

async function closed(page: Page): Promise<void> {
	await expect(page.locator('.code-lang-picker')).toHaveCount(0);
}

for (const install of INSTALLS) {
	test.describe(`the language picker's Enter, ${install.name}`, () => {
		for (const [typed, row, writes] of install.rows) {
			test(`${typed}: marks ${row ?? 'nothing'}, writes ${writes}`, async ({ page }) => {
				await openPicker(page, install.query);
				await page.keyboard.type(typed);
				if (row === null) await expect(marked(page)).toHaveCount(0);
				else await expect(marked(page)).toHaveText(row);
				await page.keyboard.press('Enter');
				await closed(page);
				expect(await opener(page)).toBe('```' + writes);
			});
		}

		test('an arrow marks the first row that only contains the typed text, and Enter takes it', async ({
			page
		}) => {
			await openPicker(page, install.query);
			await page.keyboard.type('script');
			await expect(marked(page)).toHaveCount(0);
			await page.keyboard.press('ArrowDown');
			await expect(marked(page)).toHaveText('javascript');
			await page.keyboard.press('Enter');
			await closed(page);
			expect(await opener(page)).toBe('```javascript');
		});

		test('a click takes a row that only contains the typed text', async ({ page }) => {
			await openPicker(page, install.query);
			await page.keyboard.type('script');
			await page.locator('.code-lang-name', { hasText: 'typescript' }).click();
			await closed(page);
			expect(await opener(page)).toBe('```typescript');
		});
	});
}

// latex owns the `math` fence, so its row is listed, marked by `math`, and taken by Enter, with
// the full highlight set listed (where `math` would otherwise start mathematica) and without it.
for (const seed of ['mathblock', 'math-picker-all']) {
	test(`with latex listed, math marks its own row and writes a math block (${seed})`, async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins(seed);
		await editor.loadContent('```\nx\n```\n');
		await editor.setPresentationMode('live');
		await editor.getBlock(0).hover();
		await page.locator('.code-lang-button').click();
		await expect(page.locator('.code-lang-picker input')).toBeVisible();
		await page.keyboard.type('math');
		await expect(marked(page)).toHaveText('math');
		await page.keyboard.press('Enter');
		await closed(page);
		expect(await opener(page)).toBe('```math');
		expect(await editor.bridge.getBlockKind(0)).toBe('latex/block');
	});
}
