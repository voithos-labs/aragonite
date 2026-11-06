import { test, expect } from '../../fixtures';
import { edgeKey } from '../../platform-keys';
import { PluginsPage } from './helpers';

/**
 * Turning a plugin off with `use` reads the document again and keeps the undo history.
 * Requirements: e2e/requirements/plugins/plugins-use.md.
 */

const START = 'Before\n\n$$x^2$$\n\nAfter\n';
const EVERY_BUT_LATEX = [
	'callout',
	'details',
	'admonitions',
	'mermaid',
	'memo',
	'doc-stats',
	'toc'
];

test.describe('use turns a plugin off and keeps the history', () => {
	test('three edits, latex off, three undos walk back byte for byte', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		const source = () => page.evaluate(() => (window as any).__test.getSource() as string);
		const typeAtEnd = async (path: string, text: string) => {
			await page.locator(`.editor [data-block-path="${path}"]`).click();
			await page.keyboard.press(edgeKey('lineEnd'));
			await page.keyboard.type(text);
		};

		await typeAtEnd('2', ' one');
		const one = await source();
		await typeAtEnd('0', ' two');
		const two = await source();
		await typeAtEnd('2', ' three');
		const three = await source();
		expect(three).toBe('Before two\n\n$$x^2$$\n\nAfter one three\n');

		await page.evaluate((names) => (window as any).__test.usePlugins(names), EVERY_BUT_LATEX);
		await expect.poll(source).toBe(three);
		await expect(page.locator('.editor [data-block-path="1"]')).toHaveAttribute(
			'data-block-kind',
			'paragraph'
		);

		for (const before of [two, one, START]) {
			await editor.undo();
			await expect.poll(source).toBe(before);
		}
	});
});
