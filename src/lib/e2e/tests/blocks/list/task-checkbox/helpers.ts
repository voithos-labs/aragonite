import { EditorPage } from '../../../../editor-page';

export async function waitForSourceContains(editor: EditorPage, needle: string): Promise<void> {
	await editor.page.waitForFunction((s) => (window as any).__test.getSource().includes(s), needle);
}

export async function computedDecoration(editor: EditorPage, selector: string): Promise<string> {
	const el = editor.page.locator(selector).first();
	return el.evaluate((n) => window.getComputedStyle(n).textDecorationLine);
}
