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
 * absorbed by the existing scroll-anchor correction (the `does not teleport on a
 * mid-jump` test below), the same machinery the VR suite proves for lists /
 * tables / blockquotes where estimate ≠ measured. A bounded fix — an open-aware
 * height hook the oracle consults — is a pre-freeze DESCRIPTOR widening; deferred
 * to the controller rather than built here.
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

	test('the drift does not teleport the viewport on a mid-jump (absorbed, not material)', async ({
		page
	}) => {
		await editor.loadContent(collapsedDetailsDoc(COUNT));
		expect(await topLevelSpacerCount(page)).toBeGreaterThan(0);

		// Jump into the middle: a fresh window of over-estimated details mounts and
		// measures smaller, mutating heights around the anchor. The scroll-anchor
		// correction must hold the top-of-viewport details in place.
		const scrollHeight = await editorScrollHeight(page);
		await editor.scrollEditorTo(Math.round(scrollHeight / 2));

		const before = await page.evaluate(() => {
			const editorEl = document.querySelector('.editor') as HTMLElement;
			const top = editorEl.getBoundingClientRect().top;
			const hosts = Array.from(
				document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
			) as HTMLElement[];
			for (const host of hosts) {
				const rect = host.getBoundingClientRect();
				if (rect.bottom > top + 1)
					return { path: host.getAttribute('data-block-path'), top: rect.top };
			}
			return null;
		});
		expect(before).not.toBeNull();

		await editor.waitForRenderFlush();

		const afterTop = await page.evaluate((path) => {
			const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
			return host ? host.getBoundingClientRect().top : null;
		}, before!.path);
		expect(afterTop).not.toBeNull();
		// The over-estimate is absorbed — the anchored details does not teleport.
		expect(Math.abs(afterTop! - before!.top)).toBeLessThan(200);
	});
});
