import { expect } from '@playwright/test';
import { EditorPage } from '../../../../editor-page';

export async function focusCodeBlockAtEnd(editor: EditorPage) {
	await editor.getBlock(0).click();
	await editor.page.keyboard.press('End');
}

export async function expectBody(editor: EditorPage, expectedBody: string) {
	await editor.bridge.waitForSourceWith(
		(s, expected) => {
			const m = s.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
			return m !== null && m[1] === expected;
		},
		expectedBody
	);
	const source = await editor.bridge.getSource();
	const match = source.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
	expect(match, `could not parse code block body from source:\n${source}`).not.toBeNull();
	expect(match![1]).toBe(expectedBody);
}
