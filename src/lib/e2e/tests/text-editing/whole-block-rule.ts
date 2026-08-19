import { expect } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';

// The thematic break the whole-block-focus specs drive: a rule between two paragraphs.

export const RULE_DOC = 'Before\n\n---\n\nAfter\n';

export const rule = (editor: EditorPage) => editor.page.locator('.thematic-break-block');

/** Focus the rule the way a user reaches it: Backspace at the start of the paragraph below,
 *  which the whole-block model answers by focusing the block instead of deleting it. */
export async function focusTheRule(editor: EditorPage): Promise<void> {
	await editor.focusBlockStart(2);
	await editor.page.keyboard.press('Backspace');
	await expect(wholeBlockInput(rule(editor))).toBeFocused();
}
