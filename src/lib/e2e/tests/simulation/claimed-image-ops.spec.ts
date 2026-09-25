import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// The image gestures run against bytes an inline handler has taken over: `?seed=wiki-embed`
// installs a `![[` handler that creates built-in `image` nodes, so every image gesture works on
// bytes the editor must not re-serialize. A plugin borrowing a built-in kind this way had no
// coverage here at all (`docs/contributing/rules.md` § Testing shape). What this adds over the
// wiki-embed specs is a reparse check after every move, so a resize that writes plausible bytes
// which no longer parse fails here rather than at the next edit.

const EMBED = '![[/test-fixtures/sample.png|400]]';
const EMBED_DOC = `Alpha lead paragraph.\n\n${EMBED}\n\nBeta tail paragraph.\n`;

test.describe('claimed-image-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wiki-embed');
	});

	test('resizing an inline syntax handler-claimed image keeps its syntax and stays corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(EMBED_DOC);
		await editor.waitForRenderFlush();
		const loaded = await editor.bridge.getSource();
		expect(loaded).toContain(EMBED);

		const ctx = await makeSimContext(page, editor, 'claimed-image-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		await assertCheckpoint(ctx, 'loaded');

		// ── Grow twice: the plugin's hook writes both commits ──────────────────────
		await g.resizeImage('right', 2);
		const grown = await editor.bridge.getSource();
		expect(grown).toContain('![[/test-fixtures/sample.png|440]]');
		// The corruption this session exists for: GFM bytes carry a destination in
		// parentheses, and the embed syntax has none anywhere in the document.
		expect(grown).not.toContain('](');
		await assertCheckpoint(ctx, 'embed-grown');

		// ── Shrink back: the same path in the other direction ──────────────────────
		await g.pause();
		await g.resizeImage('left', 2);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await assertCheckpoint(ctx, 'embed-shrunk');

		// ── Editing a neighbouring block must not disturb the handler's bytes ──────
		await g.pause();
		await g.lateCorrection([0]);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await assertCheckpoint(ctx, 'edited-neighbour');
	});
});
