import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { attachIme } from '../../simulation/ime';
import { makeRng } from '../../simulation/rng';
import type { CompositionCase } from '../../simulation/gestures/ime';
import { assertCoreOracles, assertParseConvergence } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// IME composition, run in the default gate: the multibyte insert path no long session had
// reached, where the other harnesses check composition on its own. The CDP driver comes in on
// the SimContext, never as a global. The run is repeatable because one seeded generator picks
// the composition from a fixed table.

const IME_DOC =
	'First prose paragraph here.\n\n' +
	'Second prose paragraph here.\n\n' +
	'Third prose paragraph here.\n';

// The candidates shown while composing and the text each commits to: the multibyte content the
// seed picks from. Kept small and fixed so a failure can be replayed.
const COMPOSITIONS: readonly CompositionCase[] = [
	{ updates: ['か', 'かん'], commit: 'かん' },
	{ updates: ['に', 'にほ', 'にほん'], commit: '日本' },
	{ updates: ['あ', 'あい'], commit: '愛' }
];

test.describe('ime-ops simulation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// One test per seed: the seed picks the compositions, so different seeds run different
	// multibyte candidates while every check still has to hold.
	for (const seed of [1, 2, 3]) {
		test(`compose / abort / commit / undo stays corruption-free (seed ${seed})`, async ({
			page
		}) => {
			const errors = attachErrorCollector(page);
			await errors.start();

			await editor.loadContent(IME_DOC);
			await editor.waitForRenderFlush();

			const ime = await attachIme(page);
			const ctx = await makeSimContext(page, editor, 'ime-ops', { errors, ime });
			const rng = makeRng(seed);
			const g = new Gestures(ctx, rng);

			const checkOracles = async (label: string): Promise<void> => {
				await assertCoreOracles(ctx, label);
				await assertParseConvergence(ctx);
			};
			await checkOracles('loaded');

			// ── Compose + commit into the first paragraph ───────────────────────────
			const first = rng.pick(COMPOSITIONS);
			await g.composeCommit(0, first);
			expect(await editor.bridge.getSource()).toContain(first.commit);
			await checkOracles('compose-commit-first');

			// ── An abandoned composition in the second paragraph changes nothing ────
			await g.composeAbort(1, rng.pick(COMPOSITIONS));
			await checkOracles('compose-abort');

			// ── Compose + commit into the third, then undo it in one step ───────────
			const beforeThird = await editor.bridge.getSource();
			await g.composeCommit(2, rng.pick(COMPOSITIONS));
			await checkOracles('compose-commit-third');

			await editor.undo();
			await editor.bridge.waitForSourceEquals(beforeThird);
			ctx.tracker.resync(beforeThird);
			await checkOracles('compose-undo');

			// The undone commit is gone; the first paragraph's commit survives.
			expect(await editor.bridge.getSource()).toContain(first.commit);
		});
	}
});
