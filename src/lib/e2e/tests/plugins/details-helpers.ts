import { expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probe surface for the `<details>` collapsible e2e suites (T4 core, the
// reveal-degrade proof, the windowing stress scenarios). Collapse is a windowing
// clamp: closed ⇒ only the summary row mounts, every body child genuinely
// unmounts. These helpers read the CST by path, the serialized bytes, and the
// mounted body-host count — the three observables the gate asserts against.

export class DetailsPage extends EditorPage {
	async gotoDetails() {
		await this.page.goto('/test/plugins?seed=details');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

export interface DetailsState {
	rootCount: number;
	kind: string;
	childCount: number;
	childKinds: string[];
	childTexts: string[];
	raw: string;
}

export async function readDetails(page: Page, index: number): Promise<DetailsState> {
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
export async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
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

export async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
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
