import { test, expect } from '../../fixtures';
import { clickEnd, enterPresentationMode, focusPath, keys, nextRow } from './helpers';
import { drawnBar } from '../../carets-showing';

// An arrow press at a code chip's edge moves the typing offset across the chip's border, not the
// caret; at a mark's edge the arrow moves the caret like anywhere else. Each test walks its rows as
// steps, every step on a fresh copy of the document.
// Requirements: e2e/requirements/presentation/presentation-live-edge-step.md.

test('live mode: a code span that ends its line', async ({ page }) => {
	const DOC = '- [ ] possibly via `scheduled`\n\nplain';
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'scheduled');
	};

	await test.step('a click at its end types inside', async () => {
		await atEnd();
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});

	await test.step('one ArrowRight types past the backtick, in the same block', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('- [ ] possibly via `scheduled`)\n');
	});

	await test.step('a second ArrowRight leaves the block', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight', 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains(')plain');
	});

	await test.step('ArrowLeft steps back inside', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight', 'ArrowLeft');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains('`scheduled)`');
	});
});

test('live mode: a hidden-marker construct that ends its line', async ({ page }) => {
	const DOC = '- [ ] possibly via **scheduled**\n\nplain';
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'scheduled');
	};

	await test.step('Shift+ArrowRight never stops at a hidden edge', async () => {
		await atEnd();
		const start = await focusPath(ep);
		await keys(ep, page, 'Shift+ArrowRight');
		const sel = await ep.bridge.getSelectionPaths();
		expect(sel?.focus.path.join()).not.toBe(start.join());
	});

	await test.step('a plain ArrowRight leaves the block, with no stop at the bold', async () => {
		await atEnd();
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type(')');
		await ep.bridge.waitForSourceContains(')plain');
	});
});

test('live mode: a chip and every mark, mid-line', async ({ page }) => {
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
	const ep = await enterPresentationMode(page, 'live', DOC);
	const atEnd = async (word: string) => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, word);
	};

	await test.step('code: one press types past the closer, the second moves the caret', async () => {
		await atEnd('code');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a `code`X b');
	});

	await test.step('code: two presses move the caret past the space', async () => {
		await atEnd('code');
		await keys(ep, page, 'ArrowRight', 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a `code` Xb');
	});

	for (const [word, beyond] of [
		['bold', 'a **bold** Xb'],
		['em', 'a *em* Xb'],
		['gone', 'a ~~gone~~ Xb']
	] as const) {
		await test.step(`${word}: one press moves the caret past the space`, async () => {
			await atEnd(word);
			await keys(ep, page, 'ArrowRight');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(beyond);
		});
	}

	await test.step('a link offers only its outside: ArrowRight at its end leaves the block', async () => {
		await atEnd('link');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});

	// The character before the opener is the space, so the letter there types plain.
	await test.step('a leading edge: walked back to the first content byte, the letter types outside', async () => {
		await atEnd('bold');
		await keys(ep, page, ...Array<string>(4).fill('ArrowLeft'));
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a X**bold** b');
	});
});

test('live mode: abutting closers have no stop of their own', async ({ page }) => {
	const DOC = 'a ***both***\n\ntail';
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('the end types inside both', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'both');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('a ***bothX***');
	});

	await test.step('one press leaves the block', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'both');
		await keys(ep, page, 'ArrowRight');
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Xtail');
	});
});

// Two constructs of one kind meet at the edge; the letter joins the one before the caret.
test('live mode: two same-kind constructs at one edge', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', '\n');

	for (const [doc, inside] of [
		['a _bold_*more* b', 'a _boldX_*more* b'],
		['a __bold__**more** b', 'a __boldX__**more** b']
	] as const) {
		await test.step(`${doc}: the end of bold types into bold`, async () => {
			await nextRow(ep, doc);
			await clickEnd(ep, page, 'bold');
			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(inside);
		});
	}
});

test('live mode: in a table cell, one ArrowRight types past the backtick inside the cell', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', '| h | h2 |\n| - | - |\n| a `cee` | z |');
	await clickEnd(ep, page, 'cee');
	await keys(ep, page, 'ArrowRight');
	await page.keyboard.type('X');
	await ep.bridge.waitForSourceContains('| a `cee`X | z |');
});

// Live keeps a code span's backticks hidden like every other marker: the edge step and the bar's
// two stops are the cue at its edge, in prose and in a cell alike.
test("live mode: a code span's backticks stay hidden, and the caret's stop marks the edge", async ({
	page
}) => {
	/** The computed display of the spans either side of each code element. */
	const backticks = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('code.inline-code-content')].flatMap((code) =>
				[code.previousElementSibling, code.nextElementSibling].map((el) =>
					el ? getComputedStyle(el).display : 'missing'
				)
			)
		);
	const ep = await enterPresentationMode(page, 'live', '\n');

	for (const [place, doc, word] of [
		['prose', 'a `code` b\n\ntail', 'code'],
		['a table cell', '| h | h2 |\n| - | - |\n| a `cee` | z |', 'cee']
	] as const) {
		await test.step(`${place}: with the caret at the span's end`, async () => {
			await nextRow(ep, doc);
			await clickEnd(ep, page, word);
			await expect.poll(backticks).toEqual(['none', 'none']);
			await expect.poll(async () => (await drawnBar(page))?.state).toBe('chip');
		});
	}
});
