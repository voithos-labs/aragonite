import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { count, findInput, openFind, openReplace, replaceInput, typeQuery } from './helpers';

/**
 * Search over a block drawn as a picture of its source
 * (`requirements/search/childless-container-match.md`). The scanner matches its source like a
 * leaf's and the block paints the match. Replace rewrites those matches through the reparse path,
 * declining, wherever the block sits, a substitution that would read it back as another block.
 */

const mermaidHost = (page: Page) => page.locator("[data-block-kind='mermaid/diagram']");

const MERMAID_FENCE = '```mermaid\ngraph TD\n\tZZNEEDLE --> B\n```\n';

const blockKinds = (page: Page) =>
	page.evaluate(() => {
		const bridge = (window as any).__test;
		return Array.from({ length: bridge.getBlockCount() }, (_, i) => bridge.getBlockKind(i));
	});

/** Types `query` into a freshly opened replace bar and waits for the tally to hold still. */
async function openReplaceOn(editor: PluginsPage, query: string, tally: RegExp): Promise<void> {
	await openReplace(editor);
	await findInput(editor.page).click();
	await typeQuery(editor, query);
	await expect(count(editor.page)).toHaveText(tally);
}

/** Replace All of `query` over `source`: only the first match, the prose's, may land. */
async function landsOnlyTheProse(editor: PluginsPage, source: string, query: string, to: string) {
	const page = editor.page;
	await editor.loadContent(source);
	const kinds = await blockKinds(page);

	await openReplaceOn(editor, query, /1\s+of\s+\d+/);
	await replaceInput(page).fill(to);
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__test.getSearchReplacedCount()))
		.toBe(1);

	expect(await editor.bridge.getSource()).toBe(source.replace(query, to));
	expect(await blockKinds(page)).toEqual(kinds);
}

const mermaidInViewport = (page: Page) =>
	page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const host = document
			.querySelector("[data-block-kind='mermaid/diagram']")
			?.getBoundingClientRect();
		return !!host && host.bottom > ed.top && host.top < ed.bottom;
	});

test.describe('search: a block drawn as a picture of its source', () => {
	let editor: PluginsPage;
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
	});

	test('a match inside a mermaid block is found, painted, and revealed by navigation', async ({
		page
	}) => {
		// Filler pushes the mermaid below the viewport, so the scroll into view can be observed.
		const filler = Array.from({ length: 40 }, (_, i) => `filler paragraph ${i}`).join('\n\n');
		await editor.loadContent(`${filler}\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);
		expect(await mermaidInViewport(page), 'mermaid must start off-screen').toBe(false);

		await openFind(editor);
		await typeQuery(editor, 'ZZNEEDLE');

		// The query exists only inside the mermaid source: finding it at all is the scan half,
		// painting it inside the host is the overlay half.
		await expect(count(page)).toHaveText(/1\s+of\s+1/);
		const overlay = mermaidHost(page).locator('.match-overlay');
		await expect(overlay).toHaveCount(1);
		const box = await overlay.boundingBox();
		expect(box!.width).toBeGreaterThan(0);

		await page.keyboard.press('Enter');
		await expect.poll(() => mermaidInViewport(page)).toBe(true);
		await expect(mermaidHost(page).locator('.match-overlay-active')).toHaveCount(1);
	});

	test('Replace All rewrites the mermaid match too, and the fence keeps its kind', async ({
		page
	}) => {
		await editor.loadContent(`prose ZZNEEDLE here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplaceOn(editor, 'ZZNEEDLE', /1\s+of\s+2/);
		await replaceInput(page).fill('FOUND');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose FOUND here');

		const source = await editor.bridge.getSource();
		expect(source).toContain('FOUND --> B'); // the container's own raw was rewritten
		expect(source).not.toContain('ZZNEEDLE');
		await expect(mermaidHost(page)).toHaveCount(1); // the reparse came back the same kind
		await expect(count(page)).toHaveText('2 replaced');
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(2);
	});

	test('a replacement that would re-kind the fence is declined, and the prose one still lands', async ({
		page
	}) => {
		// `mermaid` matches the prose and the fence's info string; rewriting the info string would
		// reparse the block as plain fenced code, the one case replace declines.
		await editor.loadContent(`prose mermaid here\n\n${MERMAID_FENCE}`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplaceOn(editor, 'mermaid', /1\s+of\s+2/);
		await replaceInput(page).fill('js');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('prose js here');

		expect(await editor.bridge.getSource()).toContain('```mermaid');
		await expect(mermaidHost(page)).toHaveCount(1);
		// The declined match survives the rescan (1 of 1), so the bar shows the tally rather
		// than the replaced count; the test hook below carries the count.
		await expect(count(page)).toHaveText(/1\s+of\s+1/);
		expect(await page.evaluate(() => (window as any).__test.getSearchReplacedCount())).toBe(1);
	});

	test('Replace on the info-string match declines it and leaves no undo step', async ({ page }) => {
		await editor.loadContent(MERMAID_FENCE);
		await expect(mermaidHost(page)).toHaveCount(1);
		const depth = await editor.bridge.getUndoDepth();

		await openReplaceOn(editor, 'mermaid', /1\s+of\s+1/);
		await replaceInput(page).fill('js');
		await page.getByRole('button', { name: 'Replace', exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.getSearchReplacedCount()))
			.toBe(0);

		expect(await editor.bridge.getSource()).toBe(MERMAID_FENCE);
		expect(await editor.bridge.getUndoDepth()).toBe(depth);
	});

	// Each block draws a picture of its source; the prose match comes first in each, so it alone
	// lands, and the block reads back as itself wherever it sits.
	const DECLINED: [name: string, source: string, query: string, to: string][] = [
		[
			'a diagram in a quote',
			'> prose mermaid\n>\n> ```mermaid\n> graph TD\n> ```\n',
			'mermaid',
			'js'
		],
		[
			'a diagram in a list item',
			'prose mermaid\n\n- ```mermaid\n  graph TD\n  ```\n',
			'mermaid',
			'js'
		],
		[
			'a diagram in an admonition',
			'prose mermaid\n\n:::note\n```mermaid\ngraph TD\n```\n:::\n',
			'mermaid',
			'js'
		],
		['a fenced formula', 'prose math\n\n```math\nx^2\n```\n', 'math', 'js'],
		['a $$ formula', 'prose $$ cost\n\n$$\nx^2\n$$\n', '$$', 'USD'],
		['a table of contents', 'prose toc\n\n[[toc]]\n', 'toc', 'list']
	];
	for (const [name, source, query, to] of DECLINED) {
		test(`a replace that would re-kind ${name} is declined, and the prose match lands`, async () => {
			await landsOnlyTheProse(editor, source, query, to);
		});
	}

	test('a code block replaced into a diagram still becomes one', async ({ page }) => {
		await editor.loadContent('```js\ngraph TD\n```\n');

		await openReplaceOn(editor, 'js', /1\s+of\s+1/);
		await replaceInput(page).fill('mermaid');
		await page.getByRole('button', { name: 'All', exact: true }).click();

		await expect(mermaidHost(page)).toHaveCount(1);
		expect(await editor.bridge.getSource()).toBe('```mermaid\ngraph TD\n```\n');
	});

	test('a replacement that eats the closing fence gets the fence back, and the block below stands', async ({
		page
	}) => {
		await editor.loadContent(`${MERMAID_FENCE}\nTail\n`);
		await expect(mermaidHost(page)).toHaveCount(1);

		await openReplace(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click();
		await typeQuery(editor, 'B\\n```');
		await expect(count(page)).toHaveText(/1\s+of\s+1/);
		await replaceInput(page).fill('C');

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await editor.bridge.waitForSourceContains('ZZNEEDLE --> C');

		expect(await editor.bridge.getSource()).toBe(
			'```mermaid\ngraph TD\n\tZZNEEDLE --> C\n```\n\nTail\n'
		);
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});
});

test.describe('search: a parrot, a picture of its source too', () => {
	test.beforeEach(async ({ page }) => {
		await new PluginsPage(page).gotoPlugins('parrot');
	});

	test('a replace that would re-kind it is declined, and the prose match lands', async ({
		page
	}) => {
		const source = 'prose parrot\n\n%%parrot party responsibly\n';
		await landsOnlyTheProse(new PluginsPage(page), source, 'parrot', 'zq');
	});
});
