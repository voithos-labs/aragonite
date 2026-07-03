import { test, expect, type Page } from '@playwright/test';
import {
	DetailsPage,
	readDetails,
	capturedErrors,
	auditRealDesyncs,
	collectInvariantWarnings,
	editorScrollHeight,
	scrollThrough
} from './details-helpers';

/**
 * Spec §8.3 — height-oracle drift, CHARACTERIZATION (pin the observed, don't
 * force). The per-kind oracle estimates an unmounted block from its full `raw`.
 * A collapsed details' raw carries its whole (hidden) body, but the rendered
 * block is one summary row, so the oracle over-estimates every off-window
 * collapsed details. In a large doc with top-level windowing active that inflates
 * the scroll height until each details is scrolled into view and measured.
 *
 * OBSERVED (Chromium, plugins harness — 40 collapsed details, ~1.1KB body each):
 * load-time scroll height ≈ 5681px vs ≈ 2416px fully measured — a ≈ 3265px
 * over-estimate, ≈ 82px per collapsed details. The fixed floor below sits an order
 * of magnitude under it so viewport-width variance can't flake the assertion.
 *
 * MATERIALITY (judged NOT material — record + guard, no fix): the drift is
 * absorbed by the editor's scroll-anchor correction (`correctAnchor` in
 * list-windowing), the sign-symmetric, scope-generic machinery the VR suite's
 * anchor tests already prove where estimate ≠ measured — the top-level `deep jump
 * ... holds the viewport via scroll-anchor correction (VR-2)` and its nested-scope
 * twin. A dedicated details mid-jump test is not carried here: this fixture's real
 * measured height (~2416px) is shorter than a viewport, so a jump to the estimated
 * middle lands past the true end and settles at the top via the browser's scrollTop
 * clamp — a clamp, not the anchor correction (verified: the settle is byte-identical
 * with `correctAnchor` neutered), so any local mid-jump assertion is vacuous. A
 * bounded fix — an open-aware height hook the oracle consults — is a pre-freeze
 * DESCRIPTOR widening; deferred to the controller rather than built here.
 */

// The over-estimate is real but the load-time window mounts a handful of details;
// the fixed floor sits far below the observed drift so viewport-width variance
// can't flake it.
const DRIFT_FLOOR_PX = 800;

function collapsedDetailsDoc(count: number): string {
	return (
		Array.from({ length: count }, (_, i) => {
			const body =
				`Paragraph A of details ${i}. ` +
				'lorem ipsum dolor sit amet '.repeat(20) +
				'\n\n' +
				`Paragraph B of details ${i}. ` +
				'consectetur adipiscing elit '.repeat(20);
			return `<details>\n<summary>Summary ${i}</summary>\n\n${body}\n\n</details>`;
		}).join('\n\n') + '\n'
	);
}

const COUNT = 40;

function topLevelSpacerCount(page: Page): Promise<number> {
	// Collapsed details mount no body, so every `.vr-spacer` is a top-level one.
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

function topLevelHostCount(page: Page): Promise<number> {
	return page.evaluate(
		() => document.querySelectorAll('[data-block-path]:not([data-block-path*=","])').length
	);
}

test.describe('plugin container: <details> height-oracle drift at scale', () => {
	let editor: DetailsPage;
	let invariantWarnings: string[];
	let pageErrors: string[];

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		invariantWarnings = collectInvariantWarnings(page);
		pageErrors = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await editor.gotoDetails();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test.afterEach(() => {
		expect(invariantWarnings).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('a run of collapsed details over-estimates scroll height until scrolled through', async ({
		page
	}) => {
		await editor.loadContent(collapsedDetailsDoc(COUNT));
		expect((await readDetails(page, 0)).rootCount).toBe(COUNT);
		expect((await readDetails(page, 0)).kind).toBe('details');
		expect((await editor.bridge.getSource()).includes('<details open>')).toBe(false);

		// Precondition: top-level windowing is active and most details are off-window
		// (estimated), or the drift below is vacuous.
		expect(await topLevelSpacerCount(page)).toBeGreaterThan(0);
		expect(await topLevelHostCount(page)).toBeLessThan(COUNT);

		const estimated = await editorScrollHeight(page);
		await scrollThrough(page, editor);
		const measured = await editorScrollHeight(page);

		const drift = estimated - measured;
		const perDetails = drift / COUNT;
		console.log(
			`details height-oracle drift ${JSON.stringify({ estimated, measured, drift, perDetails })}`
		);

		// The oracle over-estimated (collapsed raw ≫ one summary row); measuring every
		// details on the way through corrects it downward.
		expect(measured).toBeLessThan(estimated);
		expect(drift).toBeGreaterThan(DRIFT_FLOOR_PX);

		// Correctness holds under the drift: no desync, no render throw.
		expect(await auditRealDesyncs(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
