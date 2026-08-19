import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles, assertParseConvergence } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Ungated emoji-ops oracle. The `:shortcode:` rung renders an atomic glyph widget whose
// literal bytes stay in the raw, so its byte survival and mount/unmount churn are the
// silent-corruption class the oracle stack exists to catch. The decoded-entity twin of
// decoration-ops. The shortcode is typed MID-prose, adjacent to text on both sides, so the
// atomic step-over and single-press delete run against real neighbours.

const EMOJI_DOC = 'Alpha lead paragraph here.\n\n' + 'Beta tail paragraph here.\n';

test.describe('emoji-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('emoji');
	});

	test('mid-prose shortcode insert, both-directions step-over, atomic delete, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(EMOJI_DOC);
		await editor.waitForRenderFlush();
		const loaded = await editor.bridge.getSource();

		const ctx = await makeSimContext(page, editor, 'emoji-ops', { errors });
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
