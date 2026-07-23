import { type SimContext, assertStructuralIntegrity } from '../invariants';

// Native GitHub-alert container gestures for the admonitions plugin (plugins route,
// `?seed=admonitions` installs it). A `> [!TYPE]` blockquote is its own `githubAlert`
// strip container in the blockquote mold: the marker line lives only in the container
// raw + metadata, the body is real child blocks, and the bytes are never rewritten to
// `:::`. Each gesture drives real keyboard/mouse, gates on the container promotion /
// structural change, then resyncs around the reparse — never predicts across a
// paragraph→container flip. Free functions taking `ctx` first, mirroring
// gestures/footnote.ts. The formation gesture matches the github-alerts e2e's
// type-from-scratch path; the merge and unwrap gestures assert the kind-stability and
// marker-drop boundaries the container's `unwrapRole` promises.

/**
 * Form a `githubAlert` from scratch below `targetIndex`: split off a fresh line with
 * Enter, type the `> [!TYPE]` marker (which promotes the empty block to an alert with
 * the caret already in its body), then type `body` straight on — a second Enter would
 * exit the quote. Marker formation from live typing, the reclassification-plus-promotion
 * the printable tracker cannot predict, so it settles on the alert kind materializing at
 * the new index (`targetIndex + 1`) plus the marker+body in the source, and resyncs. The
 * marker interrupts the paragraph above, so no lazy-merge divergence forms.
 */
export async function typeGithubAlert(
	ctx: SimContext,
	targetIndex: number,
	alertType: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION',
	body: string
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const alertIndex = targetIndex + 1;

	await editor.focusBlockEnd(targetIndex);
	await page.keyboard.press('Enter');
	await editor.typeText(`> [!${alertType}]`);
	await editor.typeText(body);

	await editor.bridge.waitForSourceContains(`> [!${alertType}]\n> ${body}`);
	await waitForKindAt(ctx, alertIndex, 'githubAlert');
	await editor.waitForRenderFlush();
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at the start of the non-first body block at `[alertIndex, childIndex]` —
 * merges it into the previous body block (the container `default-merge`). The merge
 * must stay INSIDE the alert: the container keeps its `githubAlert` kind and its `>
 * [!TYPE]` marker, the root count holds, and only the alert's own child count drops by
 * one. Asserts each of those and fails loud if the merge escaped the container or
 * dropped the marker, so a regression in the middle-child unwrapRole cannot record a
 * corrupted tree as truth.
 */
export async function mergeGithubAlertMiddleChild(
	ctx: SimContext,
	alertIndex: number,
	childIndex: number
): Promise<void> {
	const { page, editor, tracker } = ctx;
	const before = await alertShape(ctx, alertIndex);
	if (childIndex === 0) {
		throw new Error(`[${ctx.label}] mergeGithubAlertMiddleChild needs a non-first child`);
	}

	await editor.clickBlockAtPath([alertIndex, childIndex], 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await page.waitForFunction(
		({ i, n }) => (window as any).__test.getDocument().children[i]?.children?.length === n,
		{ i: alertIndex, n: before.childCount - 1 },
		{ timeout: 2000, polling: 16 }
	);

	const after = await alertShape(ctx, alertIndex);
	if (after.rootCount !== before.rootCount || after.kind !== 'githubAlert' || !after.hasMarker) {
		throw new Error(
			`[${ctx.label}] middle-child merge escaped the alert or dropped the marker.\n` +
				`BEFORE: ${JSON.stringify(before)}\nAFTER:  ${JSON.stringify(after)}`
		);
	}
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

/**
 * Backspace at the very start of the alert's first body child at `alertIndex` — lifts
 * the first child out and drops the marker (the container `lift-first-child`), so this
 * alert loses its `githubAlert` kind and its body reparses as a plain block. The bytes
 * are never rewritten to `:::`. Asserts exactly one alert vanished (robust to sibling
 * alerts elsewhere in the session) and the `:::` form never appears; fails loud
 * otherwise. The source changes (the marker line drops), so it settles on the marker
 * leaving the source and resyncs.
 */
export async function unwrapGithubAlert(ctx: SimContext, alertIndex: number): Promise<void> {
	const { page, editor, tracker } = ctx;
	const marker = markerText(await alertShape(ctx, alertIndex));
	const alertsBefore = (await docKinds(ctx)).filter((k) => k === 'githubAlert').length;

	await editor.clickBlockAtPath([alertIndex, 0], 0);
	await page.keyboard.press('Home');
	await page.keyboard.press('Backspace');
	await editor.bridge.waitForSourceNotContains(marker);

	const source = await editor.bridge.getSource();
	const alertsAfter = (await docKinds(ctx)).filter((k) => k === 'githubAlert').length;
	if (alertsAfter !== alertsBefore - 1 || source.includes(':::')) {
		throw new Error(
			`[${ctx.label}] unwrap did not drop exactly one githubAlert, or rewrote bytes to :::.\n` +
				`ALERTS: ${alertsBefore} → ${alertsAfter}\nSOURCE: ${JSON.stringify(source)}`
		);
	}
	await assertStructuralIntegrity(ctx);
	tracker.resync(await editor.bridge.getSource());
}

// ── Internal ────────────────────────────────────────────────────────────────

interface AlertShape {
	kind: string;
	childCount: number;
	rootCount: number;
	raw: string;
	hasMarker: boolean;
}

async function alertShape(ctx: SimContext, alertIndex: number): Promise<AlertShape> {
	return ctx.page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		const node = doc.children[i];
		const raw = (node?.raw ?? '') as string;
		return {
			kind: (node?.kind ?? '') as string,
			childCount: node?.children?.length ?? 0,
			rootCount: doc.children.length,
			raw,
			hasMarker: /^> \[!/.test(raw)
		};
	}, alertIndex);
}

async function docKinds(ctx: SimContext): Promise<string[]> {
	return ctx.page.evaluate(() =>
		(window as any).__test.getDocument().children.map((c: { kind: string }) => c.kind)
	);
}

/** The `> [!TYPE]` marker line off the alert's raw — the substring whose disappearance marks the unwrap. */
function markerText(shape: AlertShape): string {
	const nl = shape.raw.indexOf('\n');
	return nl < 0 ? shape.raw : shape.raw.slice(0, nl).replace(/\r$/, '');
}

async function waitForKindAt(ctx: SimContext, index: number, kind: string): Promise<void> {
	await ctx.page.waitForFunction(
		({ i, k }) => (window as any).__test.getDocument().children[i]?.kind === k,
		{ i: index, k: kind },
		{ timeout: 2000, polling: 16 }
	);
}
