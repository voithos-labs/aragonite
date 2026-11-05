import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { OUTLINE_NOTE } from '../../simulation/notes/outline-note';
import { READING_NOTES_NOTE } from '../../simulation/notes/reading-notes-note';
import { PROJECT_PLAN_NOTE } from '../../simulation/notes/project-plan-note';

// The notes whose end state holds a construct nothing else types, run in the default gate with the
// screenshots off; `diverse-notes-capture.spec.ts` runs them again with the screenshots on. The
// seeds match the capture run's, so a failure in either reproduces in the other.
test.describe('note-taking simulation: diverse notes', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('builds the three-level outline note', async ({ page }) => {
		await runSession(page, editor, { seed: 31, note: OUTLINE_NOTE, capture: false });
	});

	test('builds the nested-blockquote reading-notes note', async ({ page }) => {
		await runSession(page, editor, { seed: 37, note: READING_NOTES_NOTE, capture: false });
	});

	test('builds the structurally-deep project-plan note', async ({ page }) => {
		await runSession(page, editor, { seed: 29, note: PROJECT_PLAN_NOTE, capture: false });
	});

	test('#817: a letter typed over the whole project-plan note replaces it', async () => {
		await editor.loadContent(PROJECT_PLAN_NOTE.expectedMarkdown);
		await editor.clickBlock(0);
		await editor.selectAll();
		await editor.selectAll();
		const before = await editor.bridge.getSource();
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
		expect(await editor.bridge.getSource()).toBe('Z\n');
	});
});
