import { expect } from '@playwright/test';
import { EditorPage } from '../../../../editor-page';

export async function focusCodeBlockAtEnd(editor: EditorPage) {
	await editor.getBlock(0).click();
	await editor.page.keyboard.press('End');
}

// Walk to `column` of the code body by keyboard — the deterministic landing a rect-derived click
// cannot give. The four leading arrows clear a 3-char opener plus its newline in the display text.
export async function focusCodeBody(editor: EditorPage, column = 0) {
	await editor.getBlock(0).click();
	await editor.focusBlockStart(0);
	for (let i = 0; i < 4 + column; i++) await editor.page.keyboard.press('ArrowRight');
}

export async function expectBody(editor: EditorPage, expectedBody: string) {
	await editor.bridge.waitForSourceWith((s, expected) => {
		const m = s.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
		return m !== null && m[1] === expected;
	}, expectedBody);
	const source = await editor.bridge.getSource();
	const match = source.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
	expect(match, `could not parse code block body from source:\n${source}`).not.toBeNull();
	expect(match![1]).toBe(expectedBody);
}
