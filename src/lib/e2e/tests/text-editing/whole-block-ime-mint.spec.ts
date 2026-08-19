import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';
import { primaryModifier } from '../../platform';
import { wholeBlockInput } from '../../whole-block-input';
import { RULE_DOC, focusTheRule, rule } from './whole-block-rule';

// Requirements: e2e/requirements/text-editing/whole-block-ime-mint.md.

/** The shape an AltGr production arrives in: `insertText` on the editing host, with no keydown
 *  branch that would admit it (`e.key` under ctrl+alt). */
async function insertTextViaCdp(editor: EditorPage, text: string): Promise<void> {
	const cdp = await editor.page.context().newCDPSession(editor.page);
	await cdp.send('Input.insertText', { text });
}

test.describe('whole-block focus — AltGr and IME input mint a paragraph below', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(RULE_DOC);
	});

	test('an AltGr-shaped insert of `€` mints a paragraph carrying it', async () => {
		await focusTheRule(editor);

		await insertTextViaCdp(editor, '€');

		await editor.bridge.waitForSourceMatches(/---\n\n€\n\nAfter/);
	});

	test('a committed composition mints the composed text, and one undo takes it back', async () => {
		const original = await editor.bridge.getSource();
		await focusTheRule(editor);
		const ime = await attachIme(editor.page);

		await ime.compose('にほん');
		await ime.commit('日本');

		await editor.bridge.waitForSourceMatches(/---\n\n日本\n\nAfter/);

		await editor.page.keyboard.press(`${primaryModifier}+z`);
		await editor.bridge.waitForSourceEquals(original);
	});

	test('an aborted composition leaves the document byte-unchanged', async () => {
		await focusTheRule(editor);
		const original = await editor.bridge.getSource();
		const ime = await attachIme(editor.page);

		await ime.compose('にほん');
		await ime.abort();

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	// A pointer entry lands natively on the block's own surface, which is not the editing host;
	// without the hand-off the first character after a click is dropped exactly as before.
	test('a pointer entry reaches the editing host too', async () => {
		await rule(editor).click();
		await expect(wholeBlockInput(rule(editor))).toBeFocused();

		await insertTextViaCdp(editor, '€');

		await editor.bridge.waitForSourceMatches(/---\n\n€\n\nAfter/);
	});

	test('reading mode: an AltGr-shaped insert changes no byte', async ({ page }) => {
		const readingEditor = new EditorPage(page);
		await readingEditor.goto('?presentationMode=reading');
		await readingEditor.loadContent(RULE_DOC);
		const original = await readingEditor.bridge.getSource();

		await rule(readingEditor).click();
		await expect(wholeBlockInput(rule(readingEditor))).toBeFocused();
		await insertTextViaCdp(readingEditor, '€');

		await readingEditor.waitForNoSourceMutation();
		expect(await readingEditor.bridge.getSource()).toBe(original);
	});
});
