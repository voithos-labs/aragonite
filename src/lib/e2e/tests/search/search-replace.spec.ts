import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { focusWalkKey } from '../../platform-keys';
import {
	count,
	findInput,
	openFind,
	openReplace,
	overlays,
	replaceInput,
	typeQuery
} from './helpers';

test.describe('search: replace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Replace rewrites the active match, advances, and leaves the rest', async ({ page }) => {
		await editor.loadContent('foo one\n\nfoo two\n\nfoo three\n');
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'foo');
		await replaceInput(page).fill('bar');
		await expect(count(page)).toHaveText(/1\s+of\s+3/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('bar one');

		const source = await editor.bridge.getSource();
		expect(source).toContain('bar one');
		expect(source).toContain('foo two');
		expect(source).toContain('foo three');
		// One match consumed; two remain.
		await expect(count(page)).toHaveText(/1\s+of\s+2/);
	});

	test('Replace All rewrites every match in one undo step', async ({ page }) => {
		await editor.loadContent('foo one\n\nfoo two\n\nfoo three\n');
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'foo');
		await replaceInput(page).fill('bar');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceNotContains('foo');

		const replaced = await editor.bridge.getSource();
		expect(replaced).not.toContain('foo');
		expect(replaced).toContain('bar one');
		expect(replaced).toContain('bar two');
		expect(replaced).toContain('bar three');

		// One undo restores the whole document. Ctrl+Z routes only through a focused block or the
		// editor root, so a block is focused first.
		await editor.clickBlock(0);
		await editor.undo();
		await editor.bridge.waitForSourceContains('foo three');
		const reverted = await editor.bridge.getSource();
		expect(reverted).toContain('foo one');
		expect(reverted).toContain('foo two');
		expect(reverted).toContain('foo three');
		expect(reverted).not.toContain('bar');
	});

	test('a regex $1 capture reference expands in the replacement', async ({ page }) => {
		await editor.loadContent('2026-06-21 and 1999-12-31\n');
		await openReplace(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, '(\\d{4})-(\\d{2})-(\\d{2})');
		await replaceInput(page).fill('$3/$2/$1');
		await expect(count(page)).toHaveText(/1\s+of\s+2/);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('21/06/2026');
		const source = await editor.bridge.getSource();
		expect(source).toContain('21/06/2026');
		expect(source).toContain('31/12/1999');
	});

	// Both replace buttons disable once no match is left, and a disabled button can't hold focus.
	for (const [button, tabs] of [
		['Replace', 1],
		['All', 2]
	] as const) {
		test(`${button} from the keyboard that leaves no match hands focus to the replace field`, async ({
			page
		}) => {
			await editor.loadContent('foo one\n');
			await openReplace(editor);
			await findInput(page).click();
			await typeQuery(editor, 'foo');
			await replaceInput(page).click();
			await page.keyboard.type('bar');
			for (let i = 0; i < tabs; i++) await page.keyboard.press(focusWalkKey());
			await expect(page.getByRole('button', { name: button, exact: true })).toBeFocused();

			await page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('bar one');
			await expect(replaceInput(page)).toBeFocused();
		});
	}
});

test.describe('search: tables', () => {
	let editor: EditorPage;
	// A normal small table: header + delimiter + three body rows, all mounted.
	const TABLE =
		'| Name | Role |\n' +
		'| :--- | :--- |\n' +
		'| Ada | dev |\n' +
		'| Grace | dev |\n' +
		'| Linus | lead |\n';

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TABLE);
	});

	test('find counts and highlights matches inside table cells', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'dev');
		await expect(count(page)).toHaveText(/1\s+of\s+2/);
		// The table's BlockHost paints each match over its own text, measured by its cell.
		await expect(overlays(page)).toHaveCount(2);
		await expect(overlays(page).first()).toBeVisible();
	});

	test('Replace All rewrites text in every matching cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		// Both cells, not one: waiting on a single 'engineer' would race the second replacement.
		await editor.bridge.waitForSourceMatches(/engineer[\s\S]*engineer/);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('| dev |');
		expect(source).toContain('engineer');
		expect(source.match(/engineer/g)?.length).toBe(2);
		// The table structure survives: still one table block.
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('single Replace on a cell match rewrites only that cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');
		await expect(count(page)).toHaveText(/1\s+of\s+2/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('engineer');
		const source = await editor.bridge.getSource();
		// Exactly one cell changed; the other still reads dev.
		expect(source.match(/engineer/g)?.length).toBe(1);
		expect(source).toContain('| dev |');
		await expect(count(page)).toHaveText(/1\s+of\s+1/);
	});
});
