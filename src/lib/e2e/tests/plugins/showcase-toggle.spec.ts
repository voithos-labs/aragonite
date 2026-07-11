import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { readDoc, waitForDoc, roundTripStable } from './helpers';

// The main `/test/editor` harness installs every dogfood plugin behind `?plugins=1`.
// The route is also the fixture for the e2e/simulation/perf batteries, which assume
// plugin-free grammar, so the load-bearing gate is the DEFAULT-OFF pin: without the
// param, plugin markers stay inert. The positive test proves the toggle wires the
// whole array; the pin proves the param-less path is plugin-free.

const PLUGIN_KINDS = ['note', 'admonition', 'details', 'mathBlock', 'mermaid', 'memo'];

test.describe('/test/editor plugin showcase toggle', () => {
	let editor: EditorPage;

	test.beforeEach(({ page }) => {
		editor = new EditorPage(page);
	});

	test('?plugins=1 installs every dogfood and round-trips the showcase seed', async ({ page }) => {
		await editor.goto('?plugins=1');

		// Spot-check kinds spread across the install order: callout (first), an
		// admonition kind callout does not claim, details, math, mermaid, memo (last).
		const doc = await waitForDoc(page, (s) =>
			['note', 'admonition', 'details', 'mermaid'].every((k) => s.kinds.includes(k))
		);
		expect(doc.kinds).toContain('note');
		expect(doc.kinds).toContain('admonition');
		expect(doc.kinds).toContain('details');
		expect(doc.kinds).toContain('mathBlock');
		expect(doc.kinds).toContain('mermaid');
		expect(doc.kinds).toContain('memo');

		// A hand-authored combined plugin document is exactly where byte round-trip
		// breaks (details blank-line wrap, `$$` fencing, `%%` placement); prove it
		// serializes back under the live plugin grammar.
		expect(await roundTripStable(page)).toBe(true);

		await expect(page.getByTestId('plugins-mode-badge')).toBeVisible();
	});

	test('default-off pin: no param keeps :::note a paragraph, grammar plugin-free', async ({
		page
	}) => {
		await editor.goto();
		await editor.loadContent(':::note Title\nBody\n:::\n');

		const doc = await readDoc(page);
		// The whole point: with no plugins installed, `:::note` is inert Markdown.
		expect(doc.kinds[0]).toBe('paragraph');
		expect(doc.kinds[0]).not.toBe('note');
		expect(doc.kinds[0]).not.toBe('directiveContainer');
		// No plugin kind reaches the param-less document — the guarantee every other
		// battery leans on.
		for (const kind of PLUGIN_KINDS) {
			expect(doc.kinds).not.toContain(kind);
		}

		await expect(page.getByTestId('plugins-mode-badge')).toHaveCount(0);
	});
});
