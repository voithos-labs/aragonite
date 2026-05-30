import { test } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

test.describe('note-taking simulation: transcription smoke', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('drives a short note from empty and the oracle suite holds', async ({ page }) => {
		await runSession(page, editor, { seed: 1, note: BIOLOGY_NOTE, capture: false });
	});
});
