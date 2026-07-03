import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * WS-B Cycle 2 — the `<details>` collapsible, the second reserved-chrome
 * consumer. Collapse is a windowing clamp: closed ⇒ only the summary row
 * mounts, every body child genuinely unmounts. This gate proves the toggle
 * (open metadata ↔ opener bytes), the clamp's mount/unmount, and the three
 * decided caret rules — asserted against the CST by path, the serialized
 * bytes, and the mounted body-host count.
 */
class PluginsPage extends EditorPage {
	async gotoDetails() {
		await this.page.goto('/test/plugins?seed=details');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

interface DetailsState {
	rootCount: number;
	kind: string;
	childCount: number;
	childKinds: string[];
	childTexts: string[];
	raw: string;
}

async function readDetails(page: Page, index: number): Promise<DetailsState> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		const d = doc.children[i];
		return {
			rootCount: doc.children.length,
			kind: d?.kind ?? '',
			childCount: d?.children?.length ?? 0,
			childKinds: (d?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
			childTexts: (d?.children ?? []).map((c: { raw?: string }) =>
				(c.raw ?? '').replace(/\n+$/, '')
			),
			raw: d?.raw ?? ''
		};
	}, index);
}

// CST path of the block holding the DOM caret — the oracle for "the caret landed".
async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
}

// Body children mount as `.block-host`s inside the box; the count drops to the
// lone summary host when collapsed — the observable proof the clamp unmounted.
async function bodyHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.details-block .block-host').length);
}

async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
}

const OPEN = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';
const SUMMARY_ONLY = '<details>\n<summary>Sum</summary>\n</details>\n';
const CLOSED_WITH_BELOW = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n\nBelow\n';

test.describe('plugin container: <details> collapsible', () => {
	let editor: PluginsPage;
	// Opaque-container + state-consistency guards emit `[invariant:…]` console
	// warnings — a channel the structured error event doesn't carry. Watch it so a
	// clamp-driven violation fails the gate instead of passing silently.
	let invariantWarnings: string[];

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		invariantWarnings = [];
		page.on('console', (m) => {
			const type = m.type();
			if ((type === 'warning' || type === 'error') && m.text().includes('[invariant:'))
				invariantWarnings.push(`${type}: ${m.text()}`);
		});
		await editor.gotoDetails();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test.afterEach(() => {
		expect(invariantWarnings).toEqual([]);
	});

	test('substrate: ?seed=details mounts the DetailsBlock component, not a raw fallback', async ({
		page
	}) => {
		const d = await readDetails(page, 0);
		expect(d.kind).toBe('details');
		expect(d.childKinds).toEqual(['details-summary', 'paragraph']);
		await expect(page.locator('.details-block')).toBeVisible();
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('toggle round-trips the opener bytes and the body mount state', async ({ page }) => {
		await editor.loadContent(OPEN);
		expect(await bodyHostCount(page)).toBe(2); // summary + body

		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		expect(await bodyHostCount(page)).toBe(1); // body genuinely unmounted
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'false');
		expect(await editor.bridge.getSource()).toBe(
			'<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n'
		);

		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details open>');
		expect(await bodyHostCount(page)).toBe(2); // body remounted
		await expect(page.locator('.details-toggle')).toHaveAttribute('aria-expanded', 'true');
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo after a collapse restores the opener bytes and remounts the body', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		expect(await bodyHostCount(page)).toBe(1);

		await editor.undo();
		await editor.bridge.waitForSourceContains('<details open>');
		expect(await bodyHostCount(page)).toBe(2);
		expect(await editor.bridge.getSource()).toBe(OPEN);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('collapsing with the caret in the body lands the caret on the summary', async ({ page }) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 1], 4); // end of "Body"
		expect(await activeBlockPath(page)).toEqual([0, 1]);

		// Mouse toggle keeps the body caret (mousedown default suppressed); the clamp
		// kills the pin, so the commit's afterTick moves the orphaned caret up.
		await editor.page.locator('.details-toggle').click();
		await editor.bridge.waitForSourceContains('<details>\n');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('M3: Enter in a collapsed summary-only details mints nothing and pushes no undo entry', async ({
		page
	}) => {
		await editor.loadContent(SUMMARY_ONLY);
		expect((await readDetails(page, 0)).childCount).toBe(1); // summary only, no body

		await editor.focusBlockAtPath([0, 0], 3); // end of "Sum"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('<summary>SumX</summary>');
		await editor.waitForUndoBatchFlush();

		await page.keyboard.press('Enter');
		await editor.waitForNoSourceMutation();
		// The gate consumed Enter: no body minted, caret stays in the summary.
		expect((await readDetails(page, 0)).childCount).toBe(1);
		expect(await activeBlockPath(page)).toEqual([0, 0]);

		// Enter pushed no undo entry: the single undo reverts the 'X' typing, not a
		// phantom mint (which would leave 'X' behind).
		await editor.undo();
		await editor.bridge.waitForSourceContains('<summary>Sum</summary>');
		expect((await readDetails(page, 0)).childCount).toBe(1);
		expect(await editor.bridge.getSource()).toBe(SUMMARY_ONLY);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('arrow-walk up from below into a collapsed details lands on the summary', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		expect(await bodyHostCount(page)).toBe(1); // body clamped out
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		await page.keyboard.press('ArrowUp');
		// The clamped-out last child can't receive focus; the walk must land on the
		// summary, not silently no-op.
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('horizontal walk (ArrowLeft) from below into a collapsed details lands on the summary', async ({
		page
	}) => {
		await editor.loadContent(CLOSED_WITH_BELOW);
		await editor.focusBlockAtPath([1], 0); // start of "Below"

		// ArrowLeft at a block start routes through `focus(CURSOR_END)`, which targets
		// the (unmounted) last child — the exact clamp path §4 flags. It must clamp to
		// the summary, not no-op on the absent ref.
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('summary editing round-trips and Enter descends into the body (inherited chrome)', async ({
		page
	}) => {
		await editor.loadContent(OPEN);
		await editor.focusBlockAtPath([0, 0], 7); // end of "Summary"
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('<summary>SummaryZ</summary>');
		expect((await readDetails(page, 0)).childKinds[0]).toBe('details-summary');

		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 1]);
		await editor.typeText('q');
		await editor.bridge.waitForSourceContains('qBody');
		expect((await readDetails(page, 0)).childTexts).toEqual(['SummaryZ', 'qBody']);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
