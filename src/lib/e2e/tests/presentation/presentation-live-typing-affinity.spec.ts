import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import {
	clickBlockSettled,
	clickEnd,
	clickWordSettled,
	enterPresentationMode,
	focusOffset,
	nextRow,
	stepTo
} from './helpers';
import { attachIme } from '../../simulation/ime';

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
const HARD_BREAK = 3;
const LEAD = 4;

/** A fresh copy of the document, the caret at the end of `block`'s line, `Home` or `End`. */
async function atLineEdge(
	ep: EditorPage,
	page: Page,
	block: number,
	key: 'Home' | 'End',
	doc = DOC
): Promise<void> {
	await nextRow(ep, doc);
	await clickBlockSettled(ep, block);
	await page.keyboard.press(key);
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
test('live mode: a symmetric pair extends by arrival', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// Rightward arrival stops on the content side, so the byte belongs to the construct, and so
	// does the one after it.
	await test.step('typing at bold’s trailing content edge extends it, and keeps extending', async () => {
		await steppedFromWord(ep, page, 'bold', 'ArrowRight', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **boldX** text');

		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('Some **boldXY** text');
	});

	// The same screen position, reached leftward across the whole closing run: the caret came
	// from outside the construct and has not entered it, so the byte lands past the `**`.
	await test.step('a caret that arrived at bold’s trailing edge from outside types past it', async () => {
		await atLineEdge(ep, page, BOLD, 'End');
		await stepTo(ep, page, 'ArrowLeft', 11);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **bold**X text');
	});

	// Leading edge, mirrored: one leftward keypress out of `bold` reaches the shared pixel but
	// has not left the construct, so the byte stays inside it.
	await test.step('a caret that stepped left out of bold’s leading edge still types inside', async () => {
		await steppedFromWord(ep, page, 'bold', 'ArrowLeft', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some **Xbold** text');
	});

	await test.step('a caret that stepped right up to bold’s leading edge types before it', async () => {
		await atLineEdge(ep, page, BOLD, 'Home');
		await stepTo(ep, page, 'ArrowRight', 5);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('Some X**bold** text');
	});
});

test('live mode: a line edge and a click place the caret without an arrival', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// The end of a line is construct-relative, not directional: `Home` on a line that opens with
	// a pair means before its opener, the opposite side in step order from `End` after a closer.
	await test.step('Home on a line opening with bold types before the construct', async () => {
		await atLineEdge(ep, page, LEAD, 'Home');
		expect(await focusOffset(ep)).toBe(2);

		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('X**Lead** in');
	});

	// A click clears how the caret arrived, so the click rule applies: the construct the caret
	// touches keeps the byte (`docs/design/live-mode.md` § 4.2).
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
test('live mode: the other symmetric pairs extend from an arrival inside them', async ({
	page
}) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// `A ~~struck~~ tail`: content [4,10). `A \`code\` tail`: content [3,7). Both reached by
	// clicking the word and stepping right, the arrival that stays inside the construct.
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

test('live mode: a never-extend construct ignores the arrival', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	// `A [link](https://example.com) tail`: the link is [2,29), `link` [3,7). Both arrivals
	// that would extend a symmetric pair put the byte past the closing `)`.
	await test.step('a link’s trailing content edge never extends, whichever arrival placed the caret', async () => {
		await steppedFromWord(ep, page, 'link', 'ArrowRight', 7);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('A [link](https://example.com)X tail');

		await clickBlockSettled(ep, LINK);
		await page.keyboard.press('End');
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
		await atLineEdge(ep, page, ESCAPE, 'Home');
		await stepTo(ep, page, 'ArrowRight', 2);
		await page.keyboard.type('X');
		await ep.bridge.waitForSourceContains('x X\\* y');

		await stepTo(ep, page, 'ArrowRight', 5);
		await page.keyboard.type('Y');
		await ep.bridge.waitForSourceContains('x X\\*Y y');
	});

	// `end  \nnext`: the two spaces before the newline are the break's markers.
	await test.step('a hard break’s trailing spaces survive a byte typed at the line end', async () => {
		await atLineEdge(ep, page, HARD_BREAK, 'Home');
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
		await atLineEdge(ep, page, ESCAPE_LEAD, 'Home', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		// Not `\Z*Lead`, which puts the backslash on screen.
		expect(await ep.bridge.getSource()).toContain('Z\\*Lead in');
	});

	await test.step('Home on a line opening with an autolink types before its bracket', async () => {
		await atLineEdge(ep, page, AUTOLINK_LEAD, 'Home', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z<https://example.com> tail');
	});

	// The caret lands at the last reachable offset, inside the closing bracket, where a byte
	// rewrites the destination: a link never extends at either edge, and the angle form is a link.
	await test.step('End after a trailing autolink types past its closing bracket', async () => {
		await atLineEdge(ep, page, AUTOLINK_TAIL, 'End', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('<https://example.com>Z');
	});

	// The discriminating counterpart: bold is already correct here, so a change that moved the
	// symmetric pair too would show up in this row.
	await test.step('the bold control is unchanged by the same gesture', async () => {
		await atLineEdge(ep, page, BOLD_LEAD, 'Home', CHILDLESS_DOC);

		await page.keyboard.type('Z');
		await ep.bridge.waitForSourceContains('Z');
		expect(await ep.bridge.getSource()).toContain('Z**Bold** in');
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

		await test.step('a composition extends it when the arrival was from inside', async () => {
			await steppedFromWord(ep, page, 'bold', 'ArrowRight', 11);

			await compose(page);
			await ep.bridge.waitForSourceContains('Some **boldかん** text');
		});

		await test.step('a composition commits past it when the arrival was from outside', async () => {
			await atLineEdge(ep, page, BOLD, 'End');
			await stepTo(ep, page, 'ArrowLeft', 11);

			await compose(page);
			await ep.bridge.waitForSourceContains('Some **bold**かん text');
		});
	});
});
