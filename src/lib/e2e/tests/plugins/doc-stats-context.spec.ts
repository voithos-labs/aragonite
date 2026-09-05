import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage } from './helpers';

// The doc-stats dogfood publishes one record per live editor to `window.__docStats`
// (requirements/plugins/doc-stats-context.md) — the observable every gate here reads.
// Single-instance scenarios run on `/test/plugins?seed=docstats` (docStats is a bare entry there,
// so its label is the 'default' options fallback); multi-instance scenarios on
// `/test/plugins/multi` (labels left/right).

interface StatsRecord {
	label: string;
	blocks: number;
	edits: number;
}
type StatsMap = Record<string, StatsRecord>;

function readStats(page: Page): Promise<StatsMap> {
	return page.evaluate(() => (window.__docStats ?? {}) as StatsMap);
}

// The predicate is serialized into the page (the waitForDoc pattern in ./helpers),
// so it must be closure-free: reference only its `s` parameter.
async function waitForStats(
	page: Page,
	predicate: (stats: StatsMap) => boolean,
	timeout = 2000
): Promise<StatsMap> {
	await page.waitForFunction(
		(predSrc) => {
			const stats = window.__docStats;
			if (!stats) return false;
			return new Function('s', `return (${predSrc})(s);`)(stats) === true;
		},
		predicate.toString(),
		{ timeout, polling: 16 }
	);
	return readStats(page);
}

// `publish()` copies the registry's record REFERENCES into `window.__docStats`, so this write
// poisons the plugin's own registry entries. Only a recompute for an instance replaces its record —
// which is what makes "the chord recomputed THIS instance" observable: its blocks recover, a
// bystander's stay at -1.
async function poisonStats(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const record of Object.values(window.__docStats ?? {})) record.blocks = -1;
	});
}

const soleRecord = (stats: StatsMap): StatsRecord => Object.values(stats)[0];

// ── Single instance: /test/plugins?seed=docstats (two paragraphs) ───────────

test.describe('doc-stats context spine: single instance', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('docstats');
		await waitForStats(page, (s) => Object.keys(s).length === 1);
	});

	test('onEditor fires once with a live document: initial stats reflect the seed', async ({
		page
	}) => {
		const stats = await readStats(page);
		expect(Object.values(stats)).toEqual([{ label: 'default', blocks: 2, edits: 0 }]);
	});

	test('an edit event recomputes stats: typing updates the edit count', async ({ page }) => {
		await editor.clickBlock(0);
		await editor.typeSlowly(' plus');
		// The `input` edit event flushes on the undo batch debounce; the poll settles on it.
		await waitForStats(
			page,
			(s) => (Object.values(s)[0]?.edits ?? 0) >= 1 && Object.values(s)[0]?.blocks === 2
		);
	});

	test('the chord from a focused paragraph republishes stats for the focused instance', async ({
		page
	}) => {
		await editor.clickBlock(0);
		await poisonStats(page);
		await page.keyboard.press('ControlOrMeta+Shift+S');
		await waitForStats(page, (s) => Object.values(s)[0]?.blocks === 2);
	});
});

// ── The regression pin: attach survives a structural edit ───────────────────
// A tracking-effect mount attach would dispose + re-fire the spine on the first `children`
// mutation, resetting the closure's cumulative edit counter (and transiently dropping the record).
// Cumulative growth across split + undo + input, then a still-resolving chord, pins the
// non-tracking attach.

test.describe('doc-stats context spine: attach survives a structural edit', () => {
	test('Enter split + undo leave the subscription live and the chord resolving', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('docstats');
		await waitForStats(page, (s) => Object.values(s)[0]?.blocks === 2);

		await editor.clickBlock(0);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		// blocks reads the LIVE document: the split's transient empty paragraph counts.
		const afterSplit = await waitForStats(page, (s) => Object.values(s)[0]?.blocks === 3);
		const editsAfterSplit = soleRecord(afterSplit).edits;
		expect(editsAfterSplit).toBeGreaterThanOrEqual(1);

		await page.keyboard.press('ControlOrMeta+z');
		const afterUndo = await waitForStats(page, (s) => Object.values(s)[0]?.blocks === 2);
		expect(soleRecord(afterUndo).edits).toBeGreaterThan(editsAfterSplit);

		await editor.typeSlowly('x');
		const afterType = await waitForStats(page, (s) => (Object.values(s)[0]?.edits ?? 0) >= 3);
		expect(soleRecord(afterType).blocks).toBe(2);

		await poisonStats(page);
		await page.keyboard.press('ControlOrMeta+Shift+S');
		await waitForStats(page, (s) => Object.values(s)[0]?.blocks === 2);
	});
});

// ── Two editors: /test/plugins/multi (left: 1 block, right: 2 blocks) ───────

test.describe('doc-stats context spine: two editors', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/test/plugins/multi');
		await waitForStats(page, (s) => Object.keys(s).length === 2);
	});

	test('per-instance options and identity: distinct labels, editorIds, block counts', async ({
		page
	}) => {
		const stats = await readStats(page);
		// Two registry keys ARE the distinct-editorId proof: a shared id would
		// collapse the second set() into the first and leave one record.
		expect(Object.keys(stats)).toHaveLength(2);
		const byLabel = Object.fromEntries(Object.values(stats).map((r) => [r.label, r]));
		expect(byLabel['left']).toMatchObject({ blocks: 1, edits: 0 });
		expect(byLabel['right']).toMatchObject({ blocks: 2, edits: 0 });
	});

	test('the chord recomputes only the dispatching instance', async ({ page }) => {
		await page.locator('.editor').nth(1).getByText('Para').click();
		await poisonStats(page);
		await page.keyboard.press('ControlOrMeta+Shift+S');

		const stats = await waitForStats(page, (s) =>
			Object.values(s).some((r) => r.label === 'right' && r.blocks === 2)
		);
		const left = Object.values(stats).find((r) => r.label === 'left');
		expect(left?.blocks).toBe(-1);
	});

	test('unmounting an editor runs the disposer: its record leaves the registry', async ({
		page
	}) => {
		await page.getByTestId('toggle-right').click();
		const stats = await waitForStats(page, (s) => Object.keys(s).length === 1);
		expect(soleRecord(stats).label).toBe('left');
	});
});
