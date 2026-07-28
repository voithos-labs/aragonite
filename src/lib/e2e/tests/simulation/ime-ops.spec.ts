import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { attachIme } from '../../simulation/ime';
import { makeRng } from '../../simulation/rng';
import type { CompositionCase } from '../../simulation/gestures/ime';
import {
	type SimContext,
	assertCoreOracles,
	assertParseConvergence
} from '../../simulation/invariants';

// Ungated IME-composition oracle. The handler-level and CDP e2e harnesses pin the
// composition contract in isolation; until this session the note-taking simulation
// typed ASCII only. It threads a real CDP composition surface through the
// SimContext (created once per session, never a global) and drives compose →
// update → commit under the corruption oracle stack — the multibyte insert path
// the state-accumulating watcher never reached. Determinism comes from a single
// seeded PRNG selecting the composition from a fixed table; the multi-seed loop
// spreads the candidates across runs.

const IME_DOC =
	'First prose paragraph here.\n\n' +
	'Second prose paragraph here.\n\n' +
	'Third prose paragraph here.\n';

// The compose stream candidates and their converted commit — the multibyte
// content the seed selects. Kept small and fixed so a failure replays.
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

	// One test per seed: the seed picks the compositions, so different seeds exercise
	// different multibyte candidates while the oracle stack holds for each.
	for (const seed of [1, 2, 3]) {
		test(`compose / abort / commit / undo stays corruption-free (seed ${seed})`, async ({
			page
		}) => {
			const errors = attachErrorCollector(page);
			await errors.start();

			await editor.loadContent(IME_DOC);
			await editor.waitForRenderFlush();
			const loaded = await editor.bridge.getSource();

			const tracker = new ExpectationTracker(loaded);
			const ime = await attachIme(page);
			const ctx: SimContext = { page, editor, tracker, errors, label: 'ime-ops', ime };
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

			// ── Aborted composition into the second paragraph (net identity) ────────
			await g.composeAbort(1, rng.pick(COMPOSITIONS));
			await checkOracles('compose-abort');

			// ── Compose + commit into the third, then undo it in one step ───────────
			const beforeThird = await editor.bridge.getSource();
			await g.composeCommit(2, rng.pick(COMPOSITIONS));
			await checkOracles('compose-commit-third');

			await editor.undo();
			await editor.bridge.waitForSourceEquals(beforeThird);
			tracker.resync(beforeThird);
			await checkOracles('compose-undo');

			// The undone commit is gone; the first paragraph's commit survives.
			expect(await editor.bridge.getSource()).toContain(first.commit);
		});
	}
});
