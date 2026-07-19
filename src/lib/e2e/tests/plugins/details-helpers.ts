import { expect, type Page } from '@playwright/test';
import { PluginsPage } from './helpers';

// Suite-specific probes for the `<details>` collapsible e2e suites (T4 core, the
// reveal-degrade proof, the windowing stress scenarios). Collapse is a windowing
// clamp: closed ⇒ only the summary row mounts, every body child genuinely
// unmounts. The shared page/read/error probes come from ./helpers; this module
// adds the mounted-host, spacer, desync, and scroll-height observables the
// collapse-clamp gates assert against.

export { activeBlockPath, capturedErrors, readContainer as readDetails } from './helpers';

export class DetailsPage extends PluginsPage {
	async gotoDetails() {
		await this.gotoPlugins('details');
	}
}

// Body children mount as `.block-host`s inside the box; the count drops to the
// lone summary host when collapsed — the observable proof the clamp unmounted.
export async function bodyHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.details-block .block-host').length);
}

// Spacers the nested details scope emits while its body windows; zero when the
// collapse clamp is active (the clamped window has no spacers).
export async function detailsSpacerCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.details-block .vr-spacer').length);
}

export interface RefDesync {
	path: number[];
	kind: string;
	childrenLen: number;
	idsLen: number;
	refsLen: number;
}

// The desync guard for the clamp's mount/unmount churn. The bridge's raw audit
// flags any container with fewer mounted refs than children — true of EVERY
// windowed or collapse-clamped scope, since `innerBlockRefs` holds only the
// mounted slice. That is not a desync. The genuine invariants are: childIds stay
// 1:1 with children, and refs never EXCEED children (the stale-trailing-slot bug
// the list-exit regression guards). Filter to those so windowing/clamp churn
// passes while a real id/ref drift still fails.
export async function auditRealDesyncs(page: Page): Promise<RefDesync[]> {
	const violations = (await page.evaluate(() =>
		(window as any).__test.auditBlockListStateConsistency()
	)) as RefDesync[];
	return violations.filter((v) => v.idsLen !== v.childrenLen || v.refsLen > v.childrenLen);
}

export const OPEN = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';
export const SUMMARY_ONLY = '<details>\n<summary>Sum</summary>\n</details>\n';
export const CLOSED_WITH_BELOW =
	'<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n\nBelow\n';
export const OPEN_WITH_BELOW =
	'<details open>\n<summary>Sum</summary>\n\nBody\n\n</details>\n\nBelow\n';

// Scroll-height of the editor's internal scroll container — the observable the
// height oracle's per-block estimates sum into. Drifts when unmounted blocks are
// estimated far from their rendered height (the collapsed-details over-estimate).
export async function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
}

// Progressive scroll 0 → bottom → 0, flushing each step, so the top-level window
// passes over (mounts + measures) every off-window block. A direct jump leaves
// skipped blocks at estimate; only mounting them replaces the estimate with the
// measured height.
export async function scrollThrough(page: Page, editor: DetailsPage): Promise<void> {
	const { viewport, scrollHeight } = await page.evaluate(() => {
		const el = document.querySelector('.editor') as HTMLElement;
		return { viewport: el.clientHeight, scrollHeight: el.scrollHeight };
	});
	// Precondition, not postcondition: a zero scroll height means there is nothing to
	// pass over, so guard it before the loop consumes it.
	expect(scrollHeight).toBeGreaterThan(0);
	const step = Math.max(1, Math.round(viewport * 0.6));
	for (let top = 0; top < scrollHeight; top += step) await editor.scrollEditorTo(top);
	await editor.scrollEditorTo(scrollHeight);
	await editor.scrollEditorTo(0);
}
