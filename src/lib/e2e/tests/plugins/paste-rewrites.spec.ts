import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';
import { textRunEnd, textRunStart } from '../../text-runs';
import { edgeKey, extendKey } from '../../platform-keys';

// The alerts plugin rewrites a pasted `%> [!TYPE]` alert to a `:::type` callout wherever a paste
// lands as blocks, and shouts any paste with `!!` in it; neither reads the editor's own copy
// (requirements/plugins/paste-rewrites.md).

const ALERT = 'intro\n\n%> [!NOTE]\n%> inside\n\nafter\n';
const TABLE = '| a | b |\n| --- | --- |\n| cell | d |\n';
const CODE = '```\ncode here\n```\n';

test.describe('a paste rewrite by block type', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('alerts');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	/** The caret past the last glyph of `text`. */
	async function caretAfter(text: string): Promise<void> {
		const end = await textRunEnd(editor.page, text);
		await editor.page.mouse.click(end.x, end.y);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
	}

	/** The editor's own copy of the alert: a range from the line above to the alert's last glyph. */
	async function copyAlert(): Promise<void> {
		await caretAfter('intro');
		const end = await textRunEnd(editor.page, 'inside');
		await editor.page.keyboard.down('Shift');
		await editor.page.mouse.click(end.x, end.y);
		await editor.page.keyboard.up('Shift');
		await editor.page.keyboard.press(extendKey('lineEnd'));
		await editor.page.keyboard.press('ControlOrMeta+c');
		await editor.clipboard.waitForContains('[!NOTE]', 2000);
	}

	test('an alert pasted mid-paragraph lands as the callout its rewrite writes', async ({
		page
	}) => {
		const start = await textRunStart(page, 'intro');
		await page.mouse.click(start.x, start.y);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await editor.seedClipboard('%> [!TIP]\n%> pasted\n');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toContain(':::tip\npasted\n:::');
		expect(await editor.bridge.getSource()).not.toContain('[!TIP]');
	});

	test("the alert's own insert row lands the alert it wrote", async ({ page }) => {
		await page.getByText('after', { exact: true }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Insert block' }).hover();
		await page.getByRole('menuitem', { name: 'Alert', exact: true }).click();
		await expect.poll(() => editor.bridge.getSource()).toBe(`${ALERT}\n%> [!NOTE]\n%> new\n`);
	});

	test('one alert line pasted after text stays text', async () => {
		await caretAfter('intro');
		await editor.seedClipboard('%> [!TIP]');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toContain('intro%> [!TIP]\n');
	});

	test("the editor's own alert, copied and pasted, keeps its bytes", async () => {
		await copyAlert();
		await caretAfter('after');
		await editor.paste();
		await expect
			.poll(() => editor.bridge.getSource())
			.toMatch(/after\n\n%> \[!NOTE\]\n%> inside\n$/);
		expect(await editor.bridge.getSource()).not.toContain(':::');
	});

	test('an alert pasted in a table cell lands rewritten below the rows above it', async () => {
		await editor.loadContent(TABLE);
		await caretAfter('cell');
		await editor.seedClipboard('%> [!TIP]\n%> from cell\n');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toContain(':::tip\nfrom cell\n:::');
		expect(await editor.bridge.getSource()).not.toContain('[!TIP]');
	});

	test("the editor's own alert pasted in a table cell keeps its bytes", async () => {
		await editor.loadContent(ALERT + '\n' + TABLE);
		await copyAlert();
		await caretAfter('cell');
		await editor.paste();
		await expect
			.poll(async () => (await editor.bridge.getSource()).match(/%> \[!NOTE\]/g)?.length)
			.toBe(2);
		expect(await editor.bridge.getSource()).not.toContain(':::');
	});

	test('Replace with clipboard rewrites an alert copied from outside', async ({ page }) => {
		await editor.loadContent(ALERT + '\n' + CODE);
		await editor.seedClipboard('%> [!WARNING]\n%> replaced\n');
		await page.getByText('code here').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Replace with clipboard' }).click();
		await expect.poll(() => editor.bridge.getSource()).toContain(':::warning\nreplaced\n:::');
		expect(await editor.bridge.getSource()).not.toContain('code here');
	});

	test("Replace with clipboard keeps the editor's own copy as it was", async ({ page }) => {
		await editor.loadContent(ALERT + '\n' + CODE);
		await copyAlert();
		await page.getByText('code here').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Replace with clipboard' }).click();
		await expect.poll(() => editor.bridge.getSource()).not.toContain('code here');
		expect((await editor.bridge.getSource()).match(/%> \[!NOTE\]/g)).toHaveLength(2);
		expect(await editor.bridge.getSource()).not.toContain(':::');
	});
});

test.describe('a whole-paste rewrite', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('alerts');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('one line pasted after text shouts, as text on its line', async ({ page }) => {
		const end = await textRunEnd(page, 'intro');
		await page.mouse.click(end.x, end.y);
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard(' wow!! ok');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toContain('intro WOW!! OK\n');
	});

	test('a line pasted in a title row shouts, as its text', async ({ page }) => {
		await editor.loadContent(':::note Title\n\nbody\n:::\n');
		const end = await textRunEnd(page, 'Title');
		await page.mouse.click(end.x, end.y);
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard(' wow!! ok');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toContain(':::note Title WOW!! OK\n');
	});

	test('a line pasted in a code body goes in as written', async ({ page }) => {
		await editor.loadContent(CODE);
		const end = await textRunEnd(page, 'code here');
		await page.mouse.click(end.x, end.y);
		await page.keyboard.press(edgeKey('lineEnd'));
		await editor.seedClipboard(' wow!! ok');
		await editor.paste();
		await expect.poll(() => editor.bridge.getSource()).toBe('```\ncode here wow!! ok\n```\n');
	});

	test('a line pasted in a shown math source goes in as written', async ({ page }) => {
		await editor.loadContent('intro\n\n$$x^2$$\n\nafter\n');
		await page.locator('.math-block-render').click();
		await expect(page.locator('.math-block-source')).toBeFocused();
		await editor.seedClipboard(' wow!! ok');
		await editor.paste();
		await page.getByText('after', { exact: true }).click();
		await expect.poll(() => editor.bridge.getSource()).toContain(' wow!! ok');
		expect(await editor.bridge.getSource()).not.toContain('WOW');
	});
});
