import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Block-tier decorations (requirements/decorations/block-decoration.md).
 * BlockHost carries the source's class/attrs on the host div and mounts the
 * badge widget as its first child. Sources register through the e2e bridge.
 */

const HOST = "[data-block-path='[0]']";

test.describe('block decorations', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('class and attrs land on the block host div', async ({ page }) => {
		await editor.loadContent('hello world\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-block',
				provide: () => [
					{ type: 'block', path: [0], class: 'e2e-block-dec', attrs: { 'data-e2e-flag': 'on' } }
				]
			});
		});

		const host = page.locator(`${HOST}.e2e-block-dec`);
		await expect(host).toHaveCount(1);
		await expect(host).toHaveAttribute('data-e2e-flag', 'on');
	});

	test('a buildDom badge mounts as the host first child, non-editable', async ({ page }) => {
		await editor.loadContent('badged block\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-badge',
				provide: () => [
					{
						type: 'block',
						path: [0],
						badge: {
							buildDom: () => {
								const el = document.createElement('span');
								el.className = 'e2e-badge-content';
								el.textContent = '⚑';
								return el;
							}
						}
					}
				]
			});
		});

		const badge = page.locator(`${HOST} > .decoration-badge`);
		await expect(badge).toHaveCount(1);
		await expect(badge).toHaveAttribute('contenteditable', 'false');
		await expect(badge.locator('.e2e-badge-content')).toHaveCount(1);
		const isFirstChild = await page.evaluate((host) => {
			const el = document.querySelector(host);
			return el?.firstElementChild?.classList.contains('decoration-badge') ?? false;
		}, HOST);
		expect(isFirstChild).toBe(true);
	});

	test('invalidating with changed class and attrs swaps them cleanly', async ({ page }) => {
		await editor.loadContent('swap me\n');
		await page.evaluate(() => {
			(window as any).__test._blockDecPhase = 0;
			(window as any).__test.decorations.addSource({
				name: 'e2e-swap',
				provide: () =>
					(window as any).__test._blockDecPhase === 0
						? [{ type: 'block', path: [0], class: 'e2e-old', attrs: { 'data-e2e-old': '1' } }]
						: [{ type: 'block', path: [0], class: 'e2e-new', attrs: { 'data-e2e-new': '1' } }]
			});
		});
		await expect(page.locator(`${HOST}.e2e-old[data-e2e-old='1']`)).toHaveCount(1);

		await page.evaluate(() => {
			(window as any).__test._blockDecPhase = 1;
			(window as any).__test.decorations.invalidateSource('e2e-swap');
		});
		await expect(page.locator(`${HOST}.e2e-new[data-e2e-new='1']`)).toHaveCount(1);
		await expect(page.locator(`${HOST}.e2e-old`)).toHaveCount(0);
		await expect(page.locator(`${HOST}[data-e2e-old]`)).toHaveCount(0);
	});

	test('disposing the source removes class, attrs, and badge', async ({ page }) => {
		await editor.loadContent('bye\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-gone',
				provide: () => [
					{
						type: 'block',
						path: [0],
						class: 'e2e-gone',
						attrs: { 'data-e2e-gone': '1' },
						badge: { buildDom: () => document.createElement('span') }
					}
				]
			});
		});
		await expect(page.locator(`${HOST}.e2e-gone`)).toHaveCount(1);
		await expect(page.locator(`${HOST} > .decoration-badge`)).toHaveCount(1);

		await page.evaluate(() => (window as any).__test.decorations.disposeSource('e2e-gone'));
		await expect(page.locator(`${HOST}.e2e-gone`)).toHaveCount(0);
		await expect(page.locator(`${HOST}[data-e2e-gone]`)).toHaveCount(0);
		await expect(page.locator(`${HOST} > .decoration-badge`)).toHaveCount(0);
	});

	test('a badged block still types and splits normally', async ({ page }) => {
		await editor.loadContent('hello\n');
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-edit',
				provide: () => [
					{
						type: 'block',
						path: [0],
						class: 'e2e-edit',
						badge: { buildDom: () => document.createElement('span') }
					}
				]
			});
		});
		await expect(page.locator(`${HOST} > .decoration-badge`)).toHaveCount(1);

		await editor.focusBlockEnd(0);
		await editor.typeText(' there');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource()))
			.toContain('hello there');

		await page.keyboard.press('Enter');
		await editor.typeText('below');
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSource()))
			.toContain('below');
		expect(await editor.getDomBlockCount()).toBe(2);
	});
});
