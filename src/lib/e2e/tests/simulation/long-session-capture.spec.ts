import { test } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

test.skip(!process.env.SIM_CAPTURE, 'set SIM_CAPTURE=1 to run the capture session');

test.describe('note-taking simulation: long-session capture', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The full note exits three lists and trips the known list-exit innerBlockRefs
	// desync (docs/issues.md). runSession finalizes the capture manifest before the
	// oracle throws, so the artifacts still land. Remove this annotation when the
	// desync is fixed — Playwright will then report this as passing unexpectedly.
	test.fail();
	test('builds the full biology note and records a checkpoint manifest', async ({ page }) => {
		await runSession(page, editor, { seed: 7, note: BIOLOGY_NOTE, capture: true });
	});
});
