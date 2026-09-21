import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

// A typed inline delimiter closes itself: a new `$` or backtick pairs with the partner the same
// keystroke adds, never with a delimiter further along the line, and typing the closer over that
// partner steps past it. The source bytes are the reference; the caret is read by typing.
// Requirements: e2e/requirements/plugins/inline-delimiter-autopair.md.

test.describe('inline delimiter auto-pair', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.setPresentationMode('live');
	});

	// The bug this guards: a lone `$` ahead of an existing formula pairing with that formula's
	// closer and wrapping the prose between them.
	test('a $ typed ahead of a formula pairs with its own twin, not the formula', async ({
		page
	}) => {
		await editor.loadContent('text and $x^2$ later\n');
		await editor.focusBlock(0, 5);
		await page.keyboard.type('$');
		await editor.bridge.waitForSourceContains('text $$and $x^2$ later');
		// The body is typed into the formula's shown source, which commits when the closer typed
		// over its partner steps past it, and the space then lands outside the formula.
		await page.keyboard.type('ab$ z');
		await editor.bridge.waitForSourceContains('text $ab$ zand $x^2$ later');
	});

	test('a backtick closes itself and the closing press steps over the twin', async ({ page }) => {
		await editor.loadContent('text and more\n');
		await editor.focusBlock(0, 5);
		await page.keyboard.type('`x` z');
		await editor.bridge.waitForSourceContains('text `x` zand more');
	});

	test('a digit after a lone $ drops the twin: a price is not math', async ({ page }) => {
		await editor.loadContent('cost is \n');
		await editor.focusBlock(0, 8);
		await page.keyboard.type('$5');
		await editor.bridge.waitForSourceContains('cost is $5');
		expect(await editor.bridge.getSource()).toBe('cost is $5\n');
	});

	test('Backspace between the twins takes both', async ({ page }) => {
		await editor.loadContent('pay \n');
		await editor.focusBlock(0, 4);
		await page.keyboard.type('$');
		await editor.bridge.waitForSourceContains('pay $$');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceContains('pay x');
		expect(await editor.bridge.getSource()).toBe('pay x\n');
	});

	// The emphasis delimiters: `**` typed ahead of an existing bold run pairs with its own
	// partner, and the byte after the run just closed lands outside it.
	test('** and ~~ pair with their own twins and close cleanly', async ({ page }) => {
		await editor.loadContent('text and **bold** later\n');
		await editor.focusBlock(0, 5);
		await page.keyboard.type('**ab** z');
		await editor.bridge.waitForSourceContains('text **ab** zand **bold** later');

		await editor.loadContent('text and ~~gone~~ later\n');
		await editor.focusBlock(0, 5);
		await page.keyboard.type('~~ab~~ z');
		await editor.bridge.waitForSourceContains('text ~~ab~~ zand ~~gone~~ later');
	});

	// The step-over is what keeps the block openers three and two keystrokes.
	test('three backticks are still a fence', async ({ page }) => {
		await editor.loadContent('above\n\n\n');
		await editor.focusBlock(1, 0);
		await page.keyboard.type('```');
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(1)).toBe('fencedCode');
	});

	// A step over a closer that leaves a line another on-type rule handles still reaches it.
	test('$$ still forms the math block as the second $ lands', async ({ page }) => {
		await editor.loadContent('above\n\n\n');
		await editor.focusBlock(1, 0);
		await page.keyboard.type('$$');
		await editor.bridge.waitForSourceContains('$$\n\n$$');
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
	});
});
