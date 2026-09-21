import { type Page } from '@playwright/test';
import { type SimContext } from '../invariants';

// Plugin-container gestures. A `<details>` renders its `.details-toggle` only on the plugins
// route, so a session using these must start from a loaded document that holds one.

/**
 * Reads the state before the click and waits for `aria-expanded` to flip, so a toggle that
 * quietly did nothing, because it is detached or unresponsive, times out instead of recording
 * a stale source. The editor rewrites the opening line itself, so the expected answer resyncs.
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
 * The simulation's only look at command dispatch: a keypress travelling from an inner child up
 * to the container's handler. Pressing the shortcut for the other type is what gives this
 * teeth, since a dead binding or a lost keypress leaves the source unchanged and the wait times
 * out, the same way `toggleCollapse` fails.
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
 * `convertAlertsOnPaste` is off by default, so the pasted bytes stay GitHub syntax and parse as
 * a `githubAlert`. Waits for the block's kind, not for the source to change: if the alert's
 * opener were broken the bytes would arrive as a plain blockquote, which still changes the
 * source, still round-trips and still leaves state clean, so no other check would notice.
 */
export async function pasteGithubAlert(ctx: SimContext): Promise<void> {
	await ctx.page.evaluate(() => navigator.clipboard.writeText('> [!TIP]\n> Pasted alert.\n'));
	await ctx.page.keyboard.press('ControlOrMeta+v');
	await ctx.page.waitForFunction(
		() => {
			const t = (window as any).__test;
			if (!(t.getSource() as string).includes('[!TIP]')) return false;
			const count = t.getBlockCount() as number;
			for (let i = 0; i < count; i++) if (t.getBlockKind(i) === 'githubAlert') return true;
			return false;
		},
		null,
		{ timeout: 5000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * A global shortcut that only reads: it rewrites `window.__docStats` and commits nothing, so
 * the bytes are unchanged. It first spoils the block count in every published record, then
 * waits for a correct one: only the command's own recompute replaces a spoiled record, and no
 * `edit` event rewrites one behind its back, so a dead binding times out loudly.
 */
export async function publishDocStats(ctx: SimContext): Promise<void> {
	await ctx.page.evaluate(() => {
		const stats = (window as any).__docStats as Record<string, { blocks: number }> | undefined;
		for (const record of Object.values(stats ?? {})) record.blocks = -1;
	});
	await ctx.page.keyboard.press('ControlOrMeta+Shift+S');
	await ctx.page.waitForFunction(
		() => {
			const stats = (window as any).__docStats as Record<string, { blocks: number }> | undefined;
			if (!stats) return false;
			const live = (window as any).__test.getDocument().children.length;
			return Object.values(stats).some((r) => r.blocks === live);
		},
		null,
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
