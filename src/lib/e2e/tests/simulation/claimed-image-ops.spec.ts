import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles, assertParseConvergence } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// The image gestures under a rung that CLAIMED the image's bytes: `?seed=wiki-embed`
// installs a `![[` rung minting built-in `image` nodes, so every existing image gesture runs
// against bytes the editor is forbidden to re-serialize — the borrow-a-built-in-kind class,
// which ran outside the oracle stack entirely (`docs/contributing/rules.md` § Testing
// shape). What this adds over the wiki-embed e2e battery is convergence after every move, so
// a resize writing plausible bytes that no longer reparse fails here, not at the next edit.

const EMBED = '![[/test-fixtures/sample.png|400]]';
const EMBED_DOC = `Alpha lead paragraph.\n\n${EMBED}\n\nBeta tail paragraph.\n`;

test.describe('claimed-image-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('wiki-embed');
	});

	test('resizing a rung-claimed image keeps its syntax and stays corruption-free', async ({
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

		// The embed's bytes are literal in the raw and round-trip cleanly, so
		// convergence holds unconditionally — no gesture here leaves the tree
		// mid-divergence.
		const checkOracles = async (label: string): Promise<void> => {
			await assertCoreOracles(ctx, label);
			await assertParseConvergence(ctx);
		};
		await checkOracles('loaded');

		// ── Grow twice: the rung's hook writes both commits ────────────────────────
		await g.resizeImage('right', 2);
		const grown = await editor.bridge.getSource();
		expect(grown).toContain('![[/test-fixtures/sample.png|440]]');
		// The corruption this session exists for: GFM bytes carry a parenthesized
		// destination, and the embed grammar has none anywhere in the document.
		expect(grown).not.toContain('](');
		await checkOracles('embed-grown');

		// ── Shrink back: the same path in the other direction ──────────────────────
		await g.pause();
		await g.resizeImage('left', 2);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await checkOracles('embed-shrunk');

		// ── Editing a neighbouring block must not disturb the claimed bytes ────────
		await g.pause();
		await g.lateCorrection([0]);
		expect(await editor.bridge.getSource()).toBe(loaded);
		await checkOracles('edited-neighbour');
	});
});
