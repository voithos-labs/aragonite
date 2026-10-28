import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { insertText } from '../insert-text';
import { attachIme } from '../simulation/ime';
import { edgeKey } from '../platform-keys';
import { wholeBlockInput } from '../whole-block-input';
import { TABLE_THEN_FENCE, arriveAtBoundary } from './selection/gap-caret-fixtures';
import { RULE_DOC, focusTheRule, rule } from './text-editing/whole-block-rule';
import { waitForFirstImageLoaded } from './blocks/image/helpers';

// Every element a composition can run in, held to one rule each (requirements/ime-hosts.md). Each
// row compares against the same element with the text typed instead: a composition ends the way
// typing does, whichever element hosts it.

interface Host {
	name: string;
	source: string;
	/** Puts the caret where the composition runs, the way a user gets there. */
	arrive(editor: EditorPage): Promise<void>;
}

const HOSTS: Host[] = [
	{
		name: 'a paragraph',
		source: 'hello\n',
		arrive: (editor) => editor.focusBlockEnd(0)
	},
	{
		name: 'a table cell',
		source: '| H |\n| :- |\n| Left |\n',
		async arrive(editor) {
			await editor.page.locator('.table-cell').nth(1).click();
			await editor.page.keyboard.press(edgeKey('lineEnd'));
		}
	},
	{
		name: 'a code block',
		source: '```\ncode\n```\n',
		arrive: (editor) => editor.focusBlock(0, '```\ncode'.length)
	},
	{
		name: 'the gap caret',
		source: TABLE_THEN_FENCE,
		arrive: arriveAtBoundary
	},
	{
		name: 'a block focused whole',
		source: RULE_DOC,
		async arrive(editor) {
			await focusTheRule(editor);
			await expect(wholeBlockInput(rule(editor))).toBeFocused();
		}
	}
];

/** The document after `enter` puts `か` in at the caret, then Enter, then a typed `Q`. */
async function afterEnter(
	editor: EditorPage,
	host: Host,
	enter: (editor: EditorPage) => Promise<void>
): Promise<string> {
	await editor.loadContent(host.source);
	await host.arrive(editor);
	await enter(editor);
	await editor.page.keyboard.press('Enter');
	await editor.typeSlowly('Q');
	await editor.bridge.waitForSourceContains('Q');
	return editor.bridge.getSource();
}

test.describe('a composition the browser drops, then Enter', () => {
	test.use({ expectWarns: ['composition'] });
	// The CDP composition owns a key pressed inside it, so Chromium drops one only after a `<br>`,
	// which `ime-composition.spec.ts` sets up in a paragraph; the hand-fired IME drops at any key.
	test.skip(({ browserName }) => browserName === 'chromium', 'Chromium drops only after a <br>');

	for (const host of HOSTS) {
		test(`${host.name}: the text is saved once and Enter acts as after typing it`, async ({
			page
		}) => {
			const editor = new EditorPage(page);
			await editor.goto();
			const typed = await afterEnter(editor, host, (e) => insertText(e.page, 'か'));
			const ime = await attachIme(page);
			const dropped = await afterEnter(editor, host, () => ime.compose('か'));

			expect(dropped).toBe(typed);
			expect(dropped.split('か')).toHaveLength(2);
		});
	}
});

// ── The key that opens a composition ────────────────────────────────────────

const IMAGE = '![pic|120x80](/test-fixtures/sample.png)';

/** A click past the image's right edge, which leaves the caret beside it with no text after. */
async function besideTheImage(editor: EditorPage): Promise<void> {
	await waitForFirstImageLoaded(editor.page);
	const box = await editor.page.locator('[data-image-widget]').first().boundingBox();
	if (!box) throw new Error('the image has no box');
	await editor.page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
}

const OPENED: Host[] = [
	{ name: 'a paragraph, beside an image', source: `${IMAGE}\n`, arrive: besideTheImage },
	...HOSTS.filter((host) => host.name !== 'a paragraph'),
	{
		name: 'a range across blocks',
		source: 'alpha\n\nbeta\n',
		async arrive(editor) {
			await editor.focusBlock(0, 2);
			await editor.selectAll();
			await editor.selectAll();
			await editor.waitForCrossBlock(true);
		}
	}
];

// Chromium and WebKit send the key that opens or feeds an IME with code 229 and no composition
// flag, named `Process` on Windows and the letter on macOS.
for (const key of ['q', 'Process']) {
	test.describe(`the key that opens a composition (${key})`, () => {
		for (const host of OPENED) {
			test(`${host.name}: no key handler takes it`, async ({ page }) => {
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.loadContent(host.source);
				await host.arrive(editor);
				const ime = await attachIme(page);

				await ime.openingKey(key);

				await editor.waitForNoSourceMutation();
				expect(await editor.bridge.getSource()).toBe(host.source);
			});
		}
	});
}
