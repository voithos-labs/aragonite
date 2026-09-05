import { EditorPage } from '../../../editor-page';

export async function countEditEvents(
	editor: EditorPage,
	action: () => Promise<void>
): Promise<number> {
	await editor.page.evaluate(() => (window as any).__test.startEditOpCapture());
	await action();
	return editor.page.evaluate(() => (window as any).__test.stopEditOpCapture().length);
}
