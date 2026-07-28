import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import {
	type SimContext,
	assertCoreOracles,
	assertParseConvergence
} from '../../simulation/invariants';

// Ungated github-alert-ops oracle for the admonitions plugin's native alerts. A `>
// [!TYPE]` blockquote is its own `githubAlert` strip container — bytes untouched,
// marker line in the container raw only — so its formation, kind-stable inner edit,
// contained middle-child merge, and marker-dropping unwrap are the container-corruption
// class the simulation's oracle stack (structured error + `[invariant:…]` watcher,
// live-CST round-trip, nested-state audit, live-vs-reparse convergence) exists to catch,
// and until this profile no gesture drove the alert container under a state-accumulating
// watcher. Mirrors math-ops/footnote-ops: a loaded document on the plugins route
// (`?seed=admonitions` installs it), the alert gesture vocabulary, all oracles
// re-checked after every move, fixed rng.
//
// The alert marker interrupts the paragraph above, so a from-scratch formation leaves no
// single-newline lazy-merge divergence — convergence runs unconditionally.

const ALERT_DOC =
	'Intro paragraph.\n\n' + // [0] — a fresh alert is typed after this
	'> [!WARNING]\n> first body\n>\n> second body\n\n' + // [1] — a seeded two-child alert
	'Tail paragraph.\n'; // [2]

class GithubAlertSimPage extends EditorPage {
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins?seed=admonitions');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

test.describe('github-alert-ops simulation', () => {
	let editor: GithubAlertSimPage;

	test.beforeEach(async ({ page }) => {
		editor = new GithubAlertSimPage(page);
		await editor.gotoPlugins();
	});

	test('alert formation, inner edit, contained merge, unwrap, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(ALERT_DOC);
		await editor.waitForRenderFlush();

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'github-alert-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = async (label: string): Promise<void> => {
			await assertCoreOracles(ctx, label);
			await assertParseConvergence(ctx);
		};
		await checkOracles('loaded');
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');

		// ── Form an alert from scratch after the tail; the seeded alert stays at [1] ─
		// Types `> [!TIP]` + body live, so the container promotes and the body lands
		// inside it. The typed alert mounts at [3].
		await g.typeGithubAlert(2, 'TIP', 'Fresh alert body');
		expect(await editor.bridge.getBlockKind(3)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('> [!TIP]\n> Fresh alert body');
		await checkOracles('typed-from-scratch');

		// ── Inner edit on the typed alert rebuilds through its marker, kind stable ───
		await g.editContainerBody([3, 0], ' plus');
		expect(await editor.bridge.getBlockKind(3)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('Fresh alert body plus');
		await checkOracles('body-edited');

		// ── Reorder the seeded alert's body children within the container ────────────
		// Alt+ArrowDown permutes body child 0 in place; the alert keeps its kind, marker,
		// and root slot — the teleport the strip-container parity fix removed.
		await g.reorderGithubAlertBodyChild(1, 0, 1);
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('[!WARNING]');
		await checkOracles('body-reordered');

		// ── Middle-child merge on the seeded alert stays inside the container ────────
		// Backspace at the start of the non-first body child folds it into its previous
		// sibling; the alert keeps its kind, marker, and root slot — assert containment.
		await g.mergeGithubAlertMiddleChild(1, 1);
		await checkOracles('middle-child-merge');

		// ── Unwrap the seeded alert: the marker drops, [1] reparses plain ───────────
		await g.unwrapGithubAlert(1);
		expect(await editor.bridge.getBlockKind(1)).not.toBe('githubAlert');
		expect(await editor.bridge.getSource()).not.toContain('[!WARNING]');
		await checkOracles('unwrapped');

		// ── Undo the unwrap (one Backspace, one entry) restores the seeded alert ────
		await g.pause();
		await g.undo();
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('[!WARNING]');
		await checkOracles('undo-unwrap');
	});
});
