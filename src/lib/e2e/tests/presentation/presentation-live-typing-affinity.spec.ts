import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickEnd,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	focusPath,
	nextRow,
	stepTo
} from './helpers';
import { attachIme } from '../../simulation/ime';
import { edgeKey } from '../../platform-keys';

// Which side of a hidden delimiter run a typed byte lands on. The source is the reference: the
// caret reports the same offset either way, so only the bytes tell the two positions apart. Each
// test walks its rows as steps, every step on a fresh copy of its document.
// Requirements: e2e/requirements/presentation/presentation-live-typing-affinity.md.

const DOC = [
	'Some **bold** text',
	'',
	'A [link](https://example.com) tail',
	'',
	'x \\* y',
	'',
	'end  ',
	'next',
	'',
	'**Lead** in',
	'',
	'A ~~struck~~ tail',
	'',
	'A `code` tail'
].join('\n');

const BOLD = 0;
const LINK = 1;
const ESCAPE = 2;
const LEAD = 4;

/** A fresh copy of the document, the caret at `edge` of `block`'s line. */
async function atLineEdge(
	ep: EditorPage,
	page: Page,
	block: number,
	edge: 'lineStart' | 'lineEnd',
	doc = DOC
): Promise<void> {
	await nextRow(ep, doc);
	await clickBlockSettled(ep, block);
	await page.keyboard.press(edgeKey(edge));
	await ep.waitForRenderFlush();
}

/** A fresh copy of the document, the caret placed by a click on `word` and stepped to `target`. */
async function steppedFromWord(
	ep: EditorPage,
	page: Page,
	word: string,
	key: string,
	target: number
): Promise<void> {
	await nextRow(ep, DOC);
	await clickWordSettled(ep, page, word);
	await stepTo(ep, page, key, target);
}

// `Some **bold** text`: strong is [5,13), `bold` [7,11).
test('live mode: a mark takes the format of the character before the caret', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// The character before the caret is bold, so the byte joins it, and so does the one after it.
	await test.step('typing at bold’s trailing content edge extends it, and keeps extending', async () => {
		await steppedFromWord(ep, page, 'bold', 'ArrowRight', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');

		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('Some **boldXY** text');
	});

	// The same screen position, reached leftward across the whole closing run: the way the caret
	// came makes no difference, the character before it is still bold.
	await test.step('a caret that came back from the text after bold types inside it too', async () => {
		await atLineEdge(ep, page, BOLD, 'lineEnd');
		await stepTo(ep, page, 'ArrowLeft', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');
	});

	// Leading edge, mirrored: the character before the opener is the space.
	await test.step('a caret that stepped left to bold’s leading edge types before it', async () => {
		await steppedFromWord(ep, page, 'bold', 'ArrowLeft', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some X**bold** text');
	});

	await test.step('a caret that stepped right up to bold’s leading edge types before it', async () => {
		await atLineEdge(ep, page, BOLD, 'lineStart');
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some X**bold** text');
	});
});

test('live mode: a line edge and a click follow the same rule', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// At a line start there is no character before the caret, so the one after decides.
	await test.step('Home on a line opening with bold types inside the construct', async () => {
		await atLineEdge(ep, page, LEAD, 'lineStart');
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('**XLead** in');
	});

	// A click on the text lands where the character before the caret, bold here, decides.
	await test.step('a click at bold’s trailing content edge extends it', async () => {
		await nextRow(ep, DOC);
		await clickEnd(ep, page, 'bold');
		await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBe(11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');
	});
});

// Bold's cases all run over a two-asterisk run. These two say the rule reads the kind's own row
// and not that run's shape: `~~` is a different two bytes, and a code span's backtick is one.
test('live mode: the other pairs extend from their inside end', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// `A ~~struck~~ tail`: content [4,10). `A \`code\` tail`: content [3,7). Both reached by
	// clicking the word and stepping right to the inside end.
	for (const [name, word, contentEnd, extended] of [
		['a strikethrough', 'struck', 10, 'A ~~struckX~~ tail'],
		['a code span', 'code', 7, 'A `codeX` tail']
	] as const) {
		await test.step(name, async () => {
			await steppedFromWord(ep, page, word, 'ArrowRight', contentEnd);

			await page.keyboard.type('X');
			await ep.bridge.waitForSourceContains(extended);
		});
	}
});

test('live mode: a never-extend construct never takes the byte', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// `A [link](https://example.com) tail`: the link is [2,29), `link` [3,7). Whichever way the
	// caret came, the byte lands past the closing `)`.
	await test.step('a link’s trailing content edge never extends, whichever way the caret came', async () => {
		await steppedFromWord(ep, page, 'link', 'ArrowRight', 7);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)X tail');

		await clickBlockSettled(ep, LINK);
		await page.keyboard.press(edgeKey('lineEnd'));
		await ep.waitForRenderFlush();
		await stepTo(ep, page, 'ArrowLeft', 7);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)YX tail');
	});

	await test.step('a link’s leading content edge never extends either', async () => {
		await steppedFromWord(ep, page, 'link', 'ArrowLeft', 2);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('A X[link](https://example.com) tail');
	});
});

test('live mode: unstamped marker runs are never typed into', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// `x \* y`: the backslash is unpainted, the `*` is the glyph. Neither side of the pair
	// admits a byte between them.
	await test.step('an escape’s two bytes stay adjacent whichever side is typed at', async () => {
		await atLineEdge(ep, page, ESCAPE, 'lineStart');
		await stepTo(ep, page, 'ArrowRight', 2);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('x X\\* y');

		await stepTo(ep, page, 'ArrowRight', 5);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('x X\\*Y y');
	});

	// `end  \nnext`: the two spaces before the newline are the break's markers.
	await test.step('a hard break’s trailing spaces survive a byte typed at the line end', async () => {
		// A click at the block's middle lands on either line by engine, so the click names the second.
		await nextRow(ep, DOC);
		await clickWordSettled(ep, page, 'next');
		await page.keyboard.press(edgeKey('lineStart'));
		await stepTo(ep, page, 'ArrowLeft', 3);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('endX  \nnext');
	});
});

// A construct with no children (a line-leading escape, an angle autolink) has no content range,
// yet a click at a line's left edge can put the caret against its run, so the rule answers.
const CHILDLESS_DOC = [
	'\\*Lead in',
	'',
	'<https://example.com> tail',
	'',
	'tail then <https://example.com>',
	'',
	'**Bold** in'
].join('\n');

const ESCAPE_LEAD = 0;
const AUTOLINK_LEAD = 1;
const AUTOLINK_TAIL = 2;
const BOLD_LEAD = 3;

test('live mode: a childless construct is all delimiters', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', CHILDLESS_DOC);

	await test.step('a click at the left edge of an escaped line types before the backslash', async () => {
		await atLineEdge(ep, page, ESCAPE_LEAD, 'lineStart', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// Not `\Z*Lead`, which puts the backslash on screen.
		expect(await ep.bridge.getSource()).toContain('Z\\*Lead in');
	});

	await test.step('Home on a line opening with an autolink types before its bracket', async () => {
		await atLineEdge(ep, page, AUTOLINK_LEAD, 'lineStart', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z<https://example.com> tail');
	});

	// The caret lands at the last reachable offset, inside the closing bracket, where a byte
	// rewrites the destination: a link never extends at either edge, and the angle form is a link.
	await test.step('End after a trailing autolink types past its closing bracket', async () => {
		await atLineEdge(ep, page, AUTOLINK_TAIL, 'lineEnd', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('<https://example.com>Z');
	});

	// The discriminating counterpart: the same gesture on a bold types inside it, from the
	// character after the caret, so a change that moved bold too would show up in this row.
	await test.step('the bold control types inside by the same gesture', async () => {
		await atLineEdge(ep, page, BOLD_LEAD, 'lineStart', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('**ZBold** in');
	});
});

// The IME half of the same rule: `insertCompositionText` is not cancelable, so the composed run
// is moved on the commit that compositionend drives: one commit, one undo entry.
test.describe('live mode: an IME commit takes the same caret position as a keystroke', () => {
	const compose = async (page: Page) => {
		const ime = await attachIme(page);
		await ime.compose('か');
		await ime.commit('かん');
	};

	test('a composition at a link’s trailing content edge commits past the closer', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await clickWordSettled(ep, page, 'link');
		await stepTo(ep, page, 'ArrowRight', 7);

		await compose(page);
		await ep.bridge.waitForSourceContains('A [link](https://example.com)かん tail');
	});

	test('at bold’s trailing edge', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);

		await test.step('a composition at its inside end extends it', async () => {
			await steppedFromWord(ep, page, 'bold', 'ArrowRight', 11);

			await compose(page);
			await ep.bridge.waitForSourceContains('Some **boldかん** text');
		});

		await test.step('a composition after a typed closer commits past it', async () => {
			await steppedFromWord(ep, page, 'bold', 'ArrowRight', 11);
			await page.keyboard.type('**');
			await ep.waitForRenderFlush();

			await compose(page);
			await ep.bridge.waitForSourceContains('Some **bold**かん text');
		});
	});
});

// A selection from a construct's end into the next block, written over: a key, a paste, an IME and
// Delete then the key all end in the write that moves text across a hidden edge.
const RANGE_DOC = [
	'a [link](u)',
	'',
	'apple',
	'',
	'a <https://x.example>',
	'',
	'berry',
	'',
	'a **bold**',
	'',
	'cherry'
].join('\n');

interface RangeHost {
	name: string;
	block: number;
	/** The raw offset End, or a click, leaves the caret at on the host's line (in Chromium). */
	end: number;
	/** What `Q` typed over the range leaves of the host's line, where it is pinned. */
	typed?: string;
}

const RANGE_HOSTS: RangeHost[] = [
	{ name: 'a link', block: 0, end: 7, typed: 'a [link](u)Qapple' },
	{ name: 'an autolink', block: 2, end: 20 },
	{ name: 'a bold', block: 4, end: 8, typed: 'a **boldQ**cherry' }
];

/** The range from `host`'s line end to the next block's start, by End and Shift+Down or a click and
 *  a Shift+click, on a fresh copy; `exact` holds the anchor at `host.end`, which live mode needn't. */
async function rangeFrom(
	ep: EditorPage,
	page: Page,
	host: RangeHost,
	by: 'keys' | 'mouse',
	exact = false
) {
	await nextRow(ep, RANGE_DOC);
	const next = [host.block + 1];
	if (by === 'keys') {
		await clickBlockSettled(ep, host.block);
		await page.keyboard.press(edgeKey('lineEnd'));
		if (exact) await stepTo(ep, page, 'ArrowLeft', host.end);
		// Source mode's last line takes the first press to its end.
		for (let i = 0; i < 3 && (await focusPath(ep)).join() !== next.join(); i++) {
			await page.keyboard.press('Shift+ArrowDown');
			await ep.waitForRenderFlush();
		}
	} else {
		await ep.clickBlockAtPath([host.block], host.end);
		await expect.poll(() => focusPath(ep), { timeout: 5000 }).toEqual([host.block]);
		await ep.shiftClickBlock(next, 0);
	}
	const range = await ep.bridge.getSelectionPaths();
	expect(range?.anchor.path).toEqual([host.block]);
	if (exact) expect(range?.anchor.offset).toBe(host.end);
	expect(range?.focus).toEqual({ path: next, offset: 0 });
}

/** The host's line once the range over it and the block after it is written over. */
async function hostLine(ep: EditorPage, host: RangeHost): Promise<string> {
	return (await ep.bridge.getSource()).split('\n\n')[host.block];
}

test.describe('live mode: text over a selection across blocks', () => {
	for (const host of RANGE_HOSTS)
		for (const by of ['keys', 'mouse'] as const) {
			test(`from ${host.name}’s end, the anchor placed by ${by}`, async ({ page }) => {
				const ep = await enterPresentationMode(page, 'live', RANGE_DOC);
				const blocks = RANGE_DOC.split('\n\n').length;

				await rangeFrom(ep, page, host, by);
				await page.keyboard.press('Delete');
				await ep.bridge.waitForBlockCount(blocks - 1);
				await page.keyboard.type('Q');
				await ep.bridge.waitForSourceContains('Q');
				const deleted = await hostLine(ep, host);
				if (host.typed) expect(deleted).toBe(host.typed);

				await test.step('a key writes what Delete and then the key write', async () => {
					await rangeFrom(ep, page, host, by);
					await page.keyboard.type('Q');
					await ep.bridge.waitForSourceContains('Q');
					expect(await hostLine(ep, host)).toBe(deleted);

					await page.keyboard.type('R');
					await ep.bridge.waitForSourceContains('R');
					expect(await hostLine(ep, host)).toBe(deleted.replace('Q', 'QR'));
				});

				await test.step('a one-line paste writes what the key writes', async () => {
					await ep.seedClipboard('Q');
					await rangeFrom(ep, page, host, by);
					await ep.paste();
					await ep.bridge.waitForSourceContains('Q');
					expect(await hostLine(ep, host)).toBe(deleted);
				});

				await test.step('an IME commits where the key’s letter landed', async () => {
					await rangeFrom(ep, page, host, by);
					const ime = await attachIme(page);
					await ime.compose('か');
					await ime.commit('かん');
					await ep.bridge.waitForSourceContains('かん');
					expect(await hostLine(ep, host)).toBe(deleted.replace('Q', 'かん'));
				});
			});
		}
});

test('source mode: text over a selection across blocks lands where it started', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'source', RANGE_DOC);
	const [link] = RANGE_HOSTS;

	await rangeFrom(ep, page, link, 'keys', true);
	await page.keyboard.type('Q');
	await ep.bridge.waitForSourceContains('Q');
	expect(await hostLine(ep, link)).toBe('a [linkQapple');
});
