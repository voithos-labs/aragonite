import { EditorPage } from '../../../../editor-page';

export async function computedDecoration(editor: EditorPage, selector: string): Promise<string> {
	const el = editor.page.locator(selector).first();
	return el.evaluate((n) => window.getComputedStyle(n).textDecorationLine);
}
