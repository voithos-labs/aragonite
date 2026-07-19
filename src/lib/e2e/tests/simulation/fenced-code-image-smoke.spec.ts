import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { runSession } from '../../simulation/user-simulator';
import { BIOLOGY_NOTE } from '../../simulation/notes/biology-note';

// Ungated fenced-code + image proxy-class oracle. The headline BIOLOGY_NOTE is the
// only note that type-builds a fenced code block AND an image (insert + resize),
// but it ran only in the SIM_CAPTURE-gated capture suites — so the always-on
// round-trip + nested-state oracle never covered those two block kinds in CI.
//
// Running it here with `capture:false` arms the cheap oracle half (the checkpoint
// hooks are no-ops without a recorder) in the default simulation gate, at one
// extra ungated session. The expensive screenshot capture stays behind
// SIM_CAPTURE in diverse-notes-capture.spec.ts.
test.describe('note-taking simulation: fenced-code + image smoke', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('builds the code-and-image biology note and the oracle suite holds', async ({ page }) => {
		await runSession(page, editor, { seed: 2, note: BIOLOGY_NOTE, capture: false });
	});
});
