import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	count,
	findInput,
	openFind,
	openReplace,
	overlays,
	replaceInput,
	typeQuery
} from './helpers';

test.describe('search — replace', () => {
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
		await expect(count(page)).toHaveText(/1\s*\/\s*3/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('bar one');

		const source = await editor.bridge.getSource();
		expect(source).toContain('bar one');
		expect(source).toContain('foo two');
		expect(source).toContain('foo three');
		// One match consumed; two remain.
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
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

		// A SINGLE undo restores the entire original document. Clicking "All" left
		// focus on the button; Ctrl+Z only routes through a focused block (or the
		// editor root), so focus a block first.
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
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('21/06/2026');
		const source = await editor.bridge.getSource();
		expect(source).toContain('21/06/2026');
		expect(source).toContain('31/12/1999');
	});
});

test.describe('search — structural replace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('a replacement introducing a heading marker changes the block kind', async ({ page }) => {
		await editor.loadContent('TITLE here\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');

		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'TITLE');
		await replaceInput(page).fill('# Heading');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('# Heading');
		await page.waitForFunction(() => (window as any).__test.getBlockKind(0) === 'heading', null, {
			timeout: 2000,
			polling: 16
		});
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	test('a replacement containing a newline splits the block in two', async ({ page }) => {
		await editor.loadContent('left SPLIT right\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);

		await openReplace(editor);
		// A single-line replace input can't carry a real newline; in regex mode a
		// literal `\n` escape expands to one (matching VS Code's regex replace).
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, 'SPLIT');
		await replaceInput(page).fill('one\\n\\ntwo');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForBlockCount(2);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		const source = await editor.bridge.getSource();
		expect(source).toContain('left one');
		expect(source).toContain('two right');
	});
});

test.describe('search — tables', () => {
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
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
		// The table's BlockHost paints one whole-cell overlay per matching cell
		// (positioned over the cell via cellRect, not nested inside [role=cell]).
		await expect(overlays(page)).toHaveCount(2);
		await expect(overlays(page).first()).toBeVisible();
	});

	test('Replace All rewrites text in every matching cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceNotContains('| dev |');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('| dev |');
		expect(source).toContain('engineer');
		expect(source.match(/engineer/g)?.length).toBe(2);
		// The table structure survives — still one table block.
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	test('single Replace on a cell match rewrites only that cell', async ({ page }) => {
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'dev');
		await replaceInput(page).fill('engineer');
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);

		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await editor.bridge.waitForSourceContains('engineer');
		const source = await editor.bridge.getSource();
		// Exactly one cell changed; the other still reads dev.
		expect(source.match(/engineer/g)?.length).toBe(1);
		expect(source).toContain('| dev |');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
	});
});
