import { type Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Plugin-container gestures. A `<details>` renders its `.details-toggle` only on the plugins
// route, so a session using these must start from a loaded document that holds one.

/**
 * Waits for `aria-expanded` to change from its state before the click, so a toggle that did
 * nothing times out instead of recording a stale source.
 */
export async function toggleCollapse(ctx: SimContext): Promise<void> {
	const toggle = ctx.page.locator('.details-toggle').first();
	const wasExpanded = (await toggle.getAttribute('aria-expanded')) === 'true';
	await toggle.click();
	await ctx.page.waitForFunction(
		(want) => document.querySelector('.details-toggle')?.getAttribute('aria-expanded') === want,
		wasExpanded ? 'false' : 'true',
		{ timeout: 5000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * The simulation's only look at command dispatch, a keypress travelling from an inner child up to
 * the container's handler: a dead binding leaves the source unchanged and the wait times out.
 */
export async function setCalloutKind(ctx: SimContext): Promise<void> {
	const calloutIdx = await topLevelCalloutIndex(ctx.page);
	if (calloutIdx < 0) throw new Error('setCalloutKind: no callout in the document');

	const current = await calloutType(ctx.page, calloutIdx);
	const next = current === 'aside' ? 'callout' : 'aside';
	const chord = next === 'aside' ? '8' : '7';

	await ctx.editor.clickBlockAtPath([calloutIdx, 1], 0);
	await ctx.page.keyboard.press(`ControlOrMeta+${chord}`);
	await ctx.editor.bridge.waitForSourceContains(`:::${next}`);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * Waits for the `githubAlert` kind, not a source change: a broken alert opener would still paste a
 * plain blockquote that changes the source and round-trips, and no other check would notice.
 */
export async function pasteGithubAlert(ctx: SimContext): Promise<void> {
	await ctx.editor.seedClipboard('> [!TIP]\n> Pasted alert.\n');
	await ctx.editor.paste();
	await ctx.page.waitForFunction(
		() => {
			const t = (window as any).__test;
			if (!(t.getSource() as string).includes('[!TIP]')) return false;
			const count = t.getBlockCount() as number;
			for (let i = 0; i < count; i++) if (t.getBlockKind(i) === 'admonitions/alert') return true;
			return false;
		},
		null,
		{ timeout: 5000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * The chord-count plugin's command writes nothing to the document: it counts a press in
 * `window.__chordCounts`, so the wait for the count to move times out on a dead binding.
 */
export async function countChord(ctx: SimContext): Promise<void> {
	const total = () =>
		ctx.page.evaluate(() =>
			Object.values(window.__chordCounts ?? {}).reduce((sum, n) => sum + n, 0)
		);
	const before = await total();
	await ctx.page.keyboard.press('ControlOrMeta+Shift+S');
	await ctx.page.waitForFunction(
		(was) => Object.values(window.__chordCounts ?? {}).reduce((sum, n) => sum + n, 0) > was,
		before,
		{ timeout: 5000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Top-level index of the callout. Changing its type keeps `kind: 'callout'`, so this still
// finds it afterwards.
async function topLevelCalloutIndex(page: Page): Promise<number> {
	return page.evaluate(() =>
		(window as any).__test
			.getDocument()
			.children.findIndex((c: { kind?: string }) => c.kind === 'callout')
	);
}

// The callout's current type, read from the opening line of the container's raw text.
async function calloutType(page: Page, calloutIdx: number): Promise<string> {
	return page.evaluate((i) => {
		const raw = ((window as any).__test.getDocument().children[i]?.raw ?? '') as string;
		return /^:::(\w+)/.exec(raw)?.[1] ?? '';
	}, calloutIdx);
}
