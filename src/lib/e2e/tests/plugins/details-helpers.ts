import { expect, type Page } from '@playwright/test';
import { PluginsPage } from './helpers';

// Reads for the `<details>` collapsible e2e suites. Collapsing clamps the window: closed, only the
// summary row mounts and every body child really unmounts. The shared page, read and error helpers
// come from ./helpers; this module adds the mounted-host count, the spacers, the mismatch check and
// the scroll height those tests assert against.

export { activeBlockPath, capturedErrors, readContainer as readDetails } from './helpers';

export class DetailsPage extends PluginsPage {
	async gotoDetails() {
		await this.gotoPlugins('details');
	}
}

// Body children mount as `.block-host`s inside the box, and the count drops to the summary host
// alone when collapsed, which is how the test sees that the clamp unmounted them.
export async function bodyHostCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.details-block .block-host').length);
}

// Spacers the nested details list emits while its body is windowed; zero while the collapse clamp
// is active, because the clamped window has none.
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

// The check against CST and DOM drifting apart as the clamp mounts and unmounts. The bridge's raw
// audit flags any container with fewer mounted references than children, which is true of every
// windowed or clamped list, since `innerBlockRefs` holds only the mounted part. What must hold is
// that childIds stay one per child, and that the references never outnumber the children, which is
// the stale trailing entry the list-exit regression guards.
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

// The scroll height of the editor's own scroll container, which is what the per-block height
// estimates add up to. It drifts when unmounted blocks are estimated far from the height they
// would render at.
export async function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
}

// Progressive scroll 0 → bottom → 0, flushing each step, so the top-level window mounts and
// measures every off-window block. A direct jump leaves skipped blocks at estimate.
export async function scrollThrough(page: Page, editor: DetailsPage): Promise<void> {
	const { viewport, scrollHeight } = await page.evaluate(() => {
		const el = document.querySelector('.editor') as HTMLElement;
		return { viewport: el.clientHeight, scrollHeight: el.scrollHeight };
	});
	// A precondition, not a postcondition: a zero scroll height means there is nothing to scroll
	// through, so check it before the loop runs.
	expect(scrollHeight).toBeGreaterThan(0);
	const step = Math.max(1, Math.round(viewport * 0.6));
	for (let top = 0; top < scrollHeight; top += step) await editor.scrollEditorTo(top);
	await editor.scrollEditorTo(scrollHeight);
	await editor.scrollEditorTo(0);
}
