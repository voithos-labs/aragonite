import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { isChromium } from '../browser-engine';
import { insertText } from '../insert-text';
import { attachIme } from '../simulation/ime';
import { edgeKey } from '../platform-keys';
import { wholeBlockInput } from '../whole-block-input';
import { TABLE_THEN_FENCE, arriveAtBoundary } from './selection/gap-caret-fixtures';
import { RULE_DOC, focusTheRule, rule } from './text-editing/whole-block-rule';

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
	test.skip(({ page }) => isChromium(page), 'Chromium drops only where the IME spec places it');

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
