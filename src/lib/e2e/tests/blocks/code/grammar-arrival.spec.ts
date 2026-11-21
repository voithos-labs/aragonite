import type { Page, Route } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { attachIme } from '../../../simulation/ime';
import { isChromium } from '../../../browser-engine';
import { edgeKey } from '../../../platform-keys';
import { BlockMathPage } from '../../plugins/latex-reveal-helpers';

// Ruby is a default language outside the eager set, so its grammar is a chunk of its own: the
// first script the page asks for once the fence is loaded. The build names chunks by hash alone.
const LAZY_CHUNK = /\/_app\/immutable\/chunks\/[^/]+\.js(\?.*)?$/;
const FENCE = '```ruby\nmain = putStrLn "hi"\n```\n';

/** Holds the next chunk the page asks for until `release` runs; `requests` counts its asks. */
async function holdGrammar(page: Page, fail = false) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const held = { url: '', requests: 0, release };
	await page.route(LAZY_CHUNK, async (route: Route) => {
		const url = route.request().url();
		if (held.url === '') held.url = url;
		if (url !== held.url) return route.fallback();
		held.requests++;
		await released;
		await (fail ? route.abort() : route.fallback());
	});
	return held;
}

test.describe('a grammar that arrives after the fence painted', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const tokens = () => editor.getBlock(0).locator('[class^="code-tok-"]');
	const height = () => editor.getBlock(0).evaluate((el) => el.getBoundingClientRect().height);
	const caretByte = (page: Page) =>
		page.evaluate(() => (window as any).__test.getBlockCursorSurface([0]).cursorOffset as number);

	async function caretAtLineEnd(page: Page) {
		await editor.getBlock(0).getByText('putStrLn', { exact: false }).click();
		await page.keyboard.press(edgeKey('lineEnd'));
	}

	test('between two typed letters, the caret and the height hold', async ({ page }) => {
		const grammar = await holdGrammar(page);
		await editor.loadContent(FENCE);
		await caretAtLineEnd(page);
		await page.keyboard.type('a');
		const before = await height();
		expect(await tokens().count()).toBe(0);

		grammar.release();
		await expect(tokens().first()).toBeVisible();
		expect(await height()).toBe(before);
		await page.keyboard.type('b');

		const source = await page.evaluate(() => (window as any).__test.getSource() as string);
		expect(source).toBe('```ruby\nmain = putStrLn "hi"ab\n```\n');
		expect(await caretByte(page)).toBe(source.indexOf('ab') + 2);
		expect(grammar.requests).toBe(1);
	});

	test('mid-composition, the composed text lands and then paints', async ({ page }) => {
		test.skip(!isChromium(page), 'composes through CDP');
		const grammar = await holdGrammar(page);
		await editor.loadContent(FENCE);
		await caretAtLineEnd(page);
		const before = await height();
		const ime = await attachIme(page);
		await ime.compose('か');

		grammar.release();
		await page.waitForResponse((response) => response.url() === grammar.url);
		await expect(editor.getBlock(0)).toContainText('"hi"か');
		await ime.commit('か');

		await expect(tokens().first()).toBeVisible();
		const source = await page.evaluate(() => (window as any).__test.getSource() as string);
		expect(source).toBe('```ruby\nmain = putStrLn "hi"か\n```\n');
		expect(await caretByte(page)).toBe(source.indexOf('か') + 1);
		expect(await height()).toBe(before);
	});

	test('during a drag selection, the selection the drag ends with holds', async ({ page }) => {
		const grammar = await holdGrammar(page);
		await editor.loadContent(FENCE);
		const box = (await editor.getBlock(0).getByText('putStrLn', { exact: false }).boundingBox())!;
		const before = await height();
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + 2, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, y, { steps: 4 });

		grammar.release();
		await expect(tokens().first()).toBeVisible();
		await page.mouse.move(box.x + box.width - 2, y, { steps: 4 });
		await page.mouse.up();

		const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected.length).toBeGreaterThan(10);
		expect('main = putStrLn "hi"').toContain(selected);
		expect(await height()).toBe(before);
	});

	test('under a selection made backward, the next Shift+ArrowLeft still extends it', async ({
		page
	}) => {
		const grammar = await holdGrammar(page);
		await editor.loadContent(FENCE);
		await caretAtLineEnd(page);
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');

		grammar.release();
		await expect(tokens().first()).toBeVisible();
		await page.keyboard.press('Shift+ArrowLeft');

		const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected).toBe(' "hi"');
	});

	test('a chunk that fails leaves the fence plain, with one error', async ({ page }) => {
		const grammar = await holdGrammar(page, true);
		await editor.loadContent('```ruby\nmain = 1\n```\n\n```ruby\nx = 2\n```\n');
		grammar.release();
		await expect
			.poll(() => page.evaluate(() => (window as any).__test.errorPlugins() as string[]))
			.toEqual(['highlight']);
		await editor.getBlock(0).click();
		await page.keyboard.type('3');
		expect(await tokens().count()).toBe(0);
		expect(await editor.getBlock(1).locator('[class^="code-tok-"]').count()).toBe(0);
		expect(grammar.requests).toBe(1);
	});

	test("tokens take the editor theme's colours, with no stylesheet from the package", async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		const keyword = editor.getBlock(0).locator('.code-tok-keyword').first();
		await expect(keyword).toHaveText('const');
		const [painted, text] = await keyword.evaluate((el) => [
			getComputedStyle(el).color,
			getComputedStyle(el.closest('[contenteditable]')!).color
		]);
		expect(painted).not.toBe(text);
	});
});

// Miss-analysis: the arrival rows ran on the code block alone, whose repaint kept a range; a source
// view's repaint went through the native-edit path, which keeps only a caret.
test.describe("a grammar that arrives in a source view's selection", () => {
	test('a select-all in the block math source survives it, so a cut takes it all', async ({
		page
	}) => {
		const math = new BlockMathPage(page);
		await math.gotoMathSeed('mathblock-highlight');
		await math.setPresentationMode('live');
		const grammar = await holdGrammar(page);
		await math.getBlock(0).click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('ArrowRight');
		await expect(math.source).toBeFocused();
		await page.keyboard.press('ControlOrMeta+a');

		grammar.release();
		await expect(math.source.locator('[class^="code-tok-"]').first()).toBeVisible();
		await page.keyboard.press('ControlOrMeta+x');
		await expect.poll(() => math.sourceText()).toBe('');
	});
});
