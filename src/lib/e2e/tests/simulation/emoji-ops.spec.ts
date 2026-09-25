import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// The emoji shortcode, run in the default gate. The `:shortcode:` handler renders one widget
// showing the emoji while its bytes stay in the raw text, so whether those bytes survive, and
// what the widget mounting and unmounting does, is exactly the quiet corruption these checks
// exist to catch. The shortcode is typed mid-sentence with text on both sides, so stepping over
// it and deleting it in one press run against real neighbours.

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

		await assertCheckpoint(ctx, 'loaded');

		// ── Insert a shortcode mid-sentence (offset 5, just past "Alpha") ───────────
		await g.typeEmojiShortcode(0, 5, 'tada');
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain('Alpha:tada: lead paragraph here.');
		await assertCheckpoint(ctx, 'emoji-typed');

		// ── Step the caret over the whole widget, both ways ─────────────────────────
		await g.stepOverEmoji(0);
		await assertCheckpoint(ctx, 'emoji-stepped');

		// Close the typing's undo entry so the delete gets its own: the batcher groups edits
		// to one block within its window, and the undo below needs the delete and the insert
		// to be two separate entries.
		await g.pause();

		// ── One Backspace removes all seven bytes, back to the loaded document ──────
		await g.atomicDeleteEmoji(0);
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await assertCheckpoint(ctx, 'emoji-deleted');

		// ── Undo back: the delete is one entry, then the typing is another ──────────
		await g.pause();
		await g.undo(); // brings the whole shortcode back in one entry
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(1);
		expect(await editor.bridge.getSource()).toContain(':tada:');
		await assertCheckpoint(ctx, 'undo-delete');

		await g.pause();
		await g.undo(); // undoes the insert, back to the loaded bytes
		await expect(page.locator("[data-block-path='[0]'] .md-emoji-widget")).toHaveCount(0);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await assertCheckpoint(ctx, 'undo-type');
	});
});
