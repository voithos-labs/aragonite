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

// Ungated emoji-ops oracle for the first-party emoji plugin. The `:shortcode:` rung
// renders an atomic glyph widget whose literal bytes stay in the raw, so its byte
// survival and mount/unmount churn are exactly the silent-corruption class the
// simulation's oracle stack (structured error + `[invariant:…]` watcher, live-CST
// round-trip, nested-state audit, live-vs-reparse convergence) exists to catch — and
// until this profile no gesture drove an emoji widget under a state-accumulating
// watcher. Mirrors decoration-ops (the decoded-entity twin): a loaded document on the
// plugins route (`?seed=emoji` installs the bare `:` rung), the emoji gesture
// vocabulary, all oracles re-checked after every move, fixed rng.
//
// The shortcode is typed MID-prose (adjacent to text on both sides), so the atomic
// step-over and single-press delete run against real neighbours — the caret-edge
// policy only the render path and its edge dispatch exercise.

const EMOJI_DOC = 'Alpha lead paragraph here.\n\n' + 'Beta tail paragraph here.\n';

class EmojiSimPage extends EditorPage {
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins?seed=emoji');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

test.describe('emoji-ops simulation', () => {
	let editor: EmojiSimPage;

	test.beforeEach(async ({ page }) => {
		editor = new EmojiSimPage(page);
		await editor.gotoPlugins();
	});

	test('mid-prose shortcode insert, both-directions step-over, atomic delete, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(EMOJI_DOC);
		await editor.waitForRenderFlush();
		const loaded = await editor.bridge.getSource();

		const tracker = new ExpectationTracker(loaded);
		const ctx: SimContext = { page, editor, tracker, errors, label: 'emoji-ops' };
		const g = new Gestures(ctx, makeRng(1));

		// Emoji bytes stay literal in the raw and round-trip cleanly, so convergence
		// holds unconditionally — no split ever leaves the tree mid-divergence here.
		const checkOracles = async (label: string): Promise<void> => {
			await assertCoreOracles(ctx, label);
			await assertParseConvergence(ctx);
		};
		await checkOracles('loaded');

		// ── Insert a shortcode mid-prose (offset 5, just past "Alpha") ──────────────
		await g.typeEmojiShortcode(0, 5, 'tada');
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Alpha:tada: lead paragraph here.');
		await checkOracles('emoji-typed');

		// ── Step the caret over the whole widget both ways (atomic island) ──────────
		await g.stepOverEmoji(0);
		await checkOracles('emoji-stepped');

		// Close the typing undo batch so the atomic delete lands as its own entry — the
		// batcher coalesces same-block edits within its window, and the undo unwind
		// below relies on the delete and the insert being two distinct entries.
		await g.pause();

		// ── Atomic delete: one Backspace removes all seven bytes, netting to loaded ──
		await g.atomicDeleteEmoji(0);
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await checkOracles('emoji-deleted');

		// ── Undo unwind: the atomic delete is one entry, then the typing is another ──
		await g.pause();
		await g.undo(); // restores the whole shortcode in one entry
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain(':tada:');
		await checkOracles('undo-delete');

		await g.pause();
		await g.undo(); // undoes the mid-prose insert, back to the loaded bytes
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await checkOracles('undo-type');
	});
});
