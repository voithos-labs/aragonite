import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { enterPresentationMode, focusPath } from './helpers';
import { textRunEnd } from '../../text-runs';

// An arrow press at a hidden construct edge moves the typing offset, not the caret. The pixel
// never moves, so the source and the ring are what tell the two offsets apart.
// Requirements: e2e/requirements/presentation/presentation-live-edge-step.md.

async function clickEnd(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunEnd(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

async function keys(ep: EditorPage, page: Page, ...pressed: string[]): Promise<void> {
	for (const key of pressed) {
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
}

const held = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.md-edge-held')].map((el) => el.tagName.toLowerCase())
	);

test.describe('live mode: a construct that ends its line', () => {
	const DOC = '- [ ] possibly via `scheduled`\n\nplain';
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
		await clickEnd(ep, page, 'scheduled');
	});

	test('a click at its end types inside', async ({ page }) => {
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});

	test('one ArrowRight types past the backtick, in the same block', async ({ page }) => {
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('- [ ] possibly via `scheduled`)\n');
	});

	test('a second ArrowRight leaves the block', async ({ page }) => {
		await keys(ep, page, 'ArrowRight', 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains(')plain');
	});

	test('ArrowLeft steps back inside', async ({ page }) => {
		await keys(ep, page, 'ArrowRight', 'ArrowLeft');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});
});

// Bold's markers stay hidden, so its line-ending edge is a stop of its own; inline code's
// backticks show for the caret's span, and the caret steps over them like any byte.
test.describe('live mode: a hidden-marker construct that ends its line', () => {
	const DOC = '- [ ] possibly via **scheduled**\n\nplain';
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
		await clickEnd(ep, page, 'scheduled');
	});

	test('Shift+ArrowRight never stops at a hidden edge', async ({ page }) => {
		const start = await focusPath(ep);
		await keys(ep, page, 'Shift+ArrowRight');
		const sel = await ep.bridge.getSelectionPaths();
		expect(sel?.focus.path.join()).not.toBe(start.join());
	});

	test('the ring shows inside, and goes with the step out', async ({ page }) => {
		await expect.poll(() => held(page)).toEqual(['strong']);
		await keys(ep, page, 'ArrowRight');
		await expect.poll(() => held(page)).toEqual([]);
		await keys(ep, page, 'ArrowLeft');
		await expect.poll(() => held(page)).toEqual(['strong']);
	});
});

test.describe('live mode: every symmetric pair, mid-line', () => {
	const DOC = [
		'a `code` b',
		'',
		'a **bold** b',
		'',
		'a *em* b',
		'',
		'a ~~gone~~ b',
		'',
		'a [link](https://x.example)',
		'',
		'tail'
	].join('\n');
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterPresentationMode(page, 'live', DOC);
	});

	for (const [word, after, beyond] of [
		['code', 'a `code`X b', 'a `code` Xb'],
		['bold', 'a **bold**X b', 'a **bold** Xb'],
		['em', 'a *em*X b', 'a *em* Xb'],
		['gone', 'a ~~gone~~X b', 'a ~~gone~~ Xb']
	] as const) {
		test(`${word}: one press types past the closer, the second moves the caret`, async ({
			page
		}) => {
			await clickEnd(ep, page, word);
			await keys(ep, page, 'ArrowRight');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(after);
		});

		test(`${word}: two presses move the caret past the space`, async ({ page }) => {
			await clickEnd(ep, page, word);
			await keys(ep, page, 'ArrowRight', 'ArrowRight');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(beyond);
		});
	}

	test('a link offers only its outside: ArrowRight at its end leaves the block', async ({
		page
	}) => {
		await clickEnd(ep, page, 'link');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});
});

test.describe('live mode: a leading edge', () => {
	test('ArrowLeft from the first content byte steps outside the opener first', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', 'lead\n\na **bold** b');
		const point = await textRunEnd(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		// Walk left to the first content byte: each press moves the caret until the opener.
		for (let i = 0; i < 4; i++) await keys(ep, page, 'ArrowLeft');
		await keys(ep, page, 'ArrowLeft');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a X**bold** b');
	});
});

test.describe('live mode: abutting closers', () => {
	const DOC = 'a ***both***\n\ntail';

	for (const [presses, source, rings] of [
		[0, 'a ***bothX***', ['em', 'strong']],
		[1, 'a ***both**X*', ['em']],
		[2, 'a ***both***X', []]
	] as const) {
		test(`${presses} press(es) at the end`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', DOC);
			await clickEnd(ep, page, 'both');
			await keys(ep, page, ...Array<string>(presses).fill('ArrowRight'));
			await expect.poll(async () => (await held(page)).sort()).toEqual([...rings].sort());
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(source);
		});
	}

	test('a third press leaves the block', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickEnd(ep, page, 'both');
		await keys(ep, page, 'ArrowRight', 'ArrowRight', 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});
});

test.describe('live mode: a table cell', () => {
	test('one ArrowRight types past the backtick inside the cell', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '| h | h2 |\n| - | - |\n| a `cee` | z |');
		await clickEnd(ep, page, 'cee');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('| a `cee`X | z |');
	});
});
