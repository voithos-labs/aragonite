import { type Page } from '@playwright/test';
import { type SimContext } from '../invariants';
import { primaryModifier } from '../../platform';

// Plugin-container gestures. A live `<details>` renders its `.details-toggle` only on the
// plugins route, so sessions driving these must start from a loaded document holding one.

/**
 * Reads the pre-click state and settles on the OPPOSITE `aria-expanded` value, so a silent
 * no-op (a detached or unresponsive toggle) fails loudly on the timeout instead of recording
 * a stale source as truth. The opener-byte rewrite is auto-behavior, so the tracker resyncs.
 */
export async function toggleCollapse(ctx: SimContext): Promise<void> {
	const toggle = ctx.page.locator('.details-toggle').first();
	const wasExpanded = (await toggle.getAttribute('aria-expanded')) === 'true';
	await toggle.click();
	await ctx.page.waitForFunction(
		(want) => document.querySelector('.details-toggle')?.getAttribute('aria-expanded') === want,
		wasExpanded ? 'false' : 'true',
		{ timeout: 2000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * The corruption oracle's only view of command dispatch: a keypress bubbling from an inner
 * leaf to the container handler. Pressing the chord for the OPPOSITE type is what gives the
 * gesture teeth — a dead binding or lost bubble leaves the source unchanged and the settle
 * times out, the same fail-loud shape `toggleCollapse` uses.
 */
export async function setCalloutKind(ctx: SimContext): Promise<void> {
	const calloutIdx = await topLevelCalloutIndex(ctx.page);
	if (calloutIdx < 0) throw new Error('setCalloutKind: no callout in the document');

	const current = await calloutType(ctx.page, calloutIdx);
	const next = current === 'aside' ? 'callout' : 'aside';
	const chord = next === 'aside' ? '8' : '7';

	await ctx.editor.clickBlockAtPath([calloutIdx, 1], 0);
	await ctx.page.keyboard.press(`${primaryModifier}+${chord}`);
	await ctx.editor.bridge.waitForSourceContains(`:::${next}`);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * `convertAlertsOnPaste` is off by default, so the pasted bytes stay GitHub syntax and parse
 * natively as a `githubAlert`. Settles on the landed KIND, not a source delta: with the alert
 * opener broken the bytes would land as a literal blockquote, which is still a delta, still
 * round-trip-stable and still nested-state clean — no oracle would trip.
 */
export async function pasteGithubAlert(ctx: SimContext): Promise<void> {
	await ctx.page.evaluate(() => navigator.clipboard.writeText('> [!TIP]\n> Pasted alert.\n'));
	await ctx.page.keyboard.press(`${primaryModifier}+v`);
	await ctx.page.waitForFunction(
		() => {
			const t = (window as any).__test;
			if (!(t.getSource() as string).includes('[!TIP]')) return false;
			const count = t.getBlockCount() as number;
			for (let i = 0; i < count; i++) if (t.getBlockKind(i) === 'githubAlert') return true;
			return false;
		},
		null,
		{ timeout: 2000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

/**
 * A READ-ONLY global chord: it republishes `window.__docStats` and commits nothing, so the
 * caller nets it to identity. POISONS every published record's block count first, then
 * settles on recovery — only the command's recompute replaces a poisoned record, and no
 * `edit` event republishes behind our back, so a dead binding times out loudly.
 */
export async function publishDocStats(ctx: SimContext): Promise<void> {
	await ctx.page.evaluate(() => {
		const stats = (window as any).__docStats as Record<string, { blocks: number }> | undefined;
		for (const record of Object.values(stats ?? {})) record.blocks = -1;
	});
	await ctx.page.keyboard.press(`${primaryModifier}+Shift+S`);
	await ctx.page.waitForFunction(
		() => {
			const stats = (window as any).__docStats as Record<string, { blocks: number }> | undefined;
			if (!stats) return false;
			const live = (window as any).__test.getDocument().children.length;
			return Object.values(stats).some((r) => r.blocks === live);
		},
		null,
		{ timeout: 2000, polling: 16 }
	);
	await ctx.editor.waitForRenderFlush();
	ctx.tracker.resync(await ctx.editor.bridge.getSource());
}

// Top-level index of the callout — the type change keeps `kind: 'callout'`,
// so this still resolves after a setKind.
async function topLevelCalloutIndex(page: Page): Promise<number> {
	return page.evaluate(() =>
		(window as any).__test
			.getDocument()
			.children.findIndex((c: { kind?: string }) => c.kind === 'callout')
	);
}

// Current callout type read off the opaque container's authoritative raw opener.
async function calloutType(page: Page, calloutIdx: number): Promise<string> {
	return page.evaluate((i) => {
		const raw = ((window as any).__test.getDocument().children[i]?.raw ?? '') as string;
		return /^:::(\w+)/.exec(raw)?.[1] ?? '';
	}, calloutIdx);
}
