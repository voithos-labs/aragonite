import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import type { ExpectationTracker } from './expectation';
import type { ErrorCollector } from './error-collector';
import { getContainerParityMismatches } from '../container-parity';

export interface SimContext {
	page: Page;
	editor: EditorPage;
	tracker: ExpectationTracker;
	errors: ErrorCollector;
	label: string;
}

// ── Content oracles ─────────────────────────────────────────────────────────

/**
 * The primary per-keystroke content oracle. On timeout the failure is a
 * readable expected-vs-actual diff plus full debug dumps, never an opaque
 * "waitForFunction timed out" — a dropped or reversed char shows immediately.
 */
export async function settleTypedSource(ctx: SimContext, expected: string): Promise<void> {
	try {
		await ctx.editor.bridge.waitForSourceEquals(expected, 2000);
	} catch {
		const actual = await ctx.editor.bridge.getSource();
		const [tree, sel, ops] = await Promise.all([
			ctx.page.evaluate(() => (window as any).__test.dumpTree()),
			ctx.page.evaluate(() => (window as any).__test.dumpSelection()),
			ctx.page.evaluate(() => (window as any).__test.dumpOperationsLog())
		]);
		throw new Error(
			`[${ctx.label}] source mismatch after keystroke.\n` +
				`EXPECTED: ${JSON.stringify(expected)}\n` +
				`ACTUAL:   ${JSON.stringify(actual)}\n` +
				`--- CST ---\n${tree}\n--- SELECTION ---\n${sel}\n--- OPS ---\n${ops}`
		);
	}
}

export async function assertContainsInOrder(
	ctx: SimContext,
	phrases: readonly string[]
): Promise<void> {
	const source = await ctx.editor.bridge.getSource();
	let cursor = 0;
	for (const phrase of phrases) {
		const at = source.indexOf(phrase, cursor);
		if (at < 0) {
			throw new Error(
				`[${ctx.label}] phrase ${JSON.stringify(phrase)} not found in order ` +
					`(searched from offset ${cursor}).\nSOURCE: ${JSON.stringify(source)}`
			);
		}
		cursor = at + phrase.length;
	}
}

export async function assertEndState(ctx: SimContext, canonicalTarget: string): Promise<void> {
	const final = await ctx.editor.bridge.getSource();
	if (final === canonicalTarget) return;
	throw new Error(
		`[${ctx.label}] end-state diverged from canonical (typing != loading).\n` +
			`EXPECTED: ${JSON.stringify(canonicalTarget)}\n` +
			`ACTUAL:   ${JSON.stringify(final)}\n` +
			describeDiff(canonicalTarget, final)
	);
}

// ── Structural / consistency oracles ────────────────────────────────────────

export async function assertNoErrors(ctx: SimContext): Promise<void> {
	await ctx.errors.assertNone();
}

/**
 * Container children/childIds parity across every keyed BlockList in the live
 * tree. A structural mutation that extends `children` without extending
 * `childIds` gives the trailing keyed-each entries `undefined` keys — Svelte's
 * earliest signal of the desync class, caught here at checkpoint cadence rather
 * than waiting for the boundary to throw mid-render. The walker throws (not
 * returns `[]`) if the doc bridge is absent, so a missing probe is loud, never
 * vacuously green.
 */
export async function assertContainerParity(ctx: SimContext): Promise<void> {
	const mismatches = await getContainerParityMismatches(ctx.page);
	if (mismatches.length) {
		throw new Error(
			`[${ctx.label}] container children/childIds parity broken:\n${JSON.stringify(mismatches, null, 2)}`
		);
	}
}

export async function assertNestedStateConsistent(ctx: SimContext): Promise<void> {
	const violations = await ctx.page.evaluate(() =>
		(window as any).__test.auditBlockListStateConsistency()
	);
	if (violations.length) {
		throw new Error(
			`[${ctx.label}] nested BlockListState desync:\n${JSON.stringify(violations, null, 2)}`
		);
	}
}

export async function assertRoundTripStable(ctx: SimContext): Promise<void> {
	const stable = await ctx.page.evaluate(() => (window as any).__test.roundTripStable());
	if (!stable) {
		const source = await ctx.editor.bridge.getSource();
		throw new Error(
			`[${ctx.label}] serializer not stable against live CST.\nSOURCE: ${JSON.stringify(source)}`
		);
	}
}

/**
 * Live-tree convergence oracle — the structural counterpart to
 * assertRoundTripStable. The byte round-trip above is a source-string fixed
 * point (a tautology for valid GFM); this compares the LIVE CST against a
 * reparse of its own serialization, catching a gesture that left the tree
 * diverging from its raw. Run at checkpoint cadence (not per keystroke), the
 * same cost tier as the round-trip check. Unconditional across every note: the
 * escape gesture auto-closes an unclosed fence, so no build is left divergent.
 */
export async function assertParseConvergence(ctx: SimContext): Promise<void> {
	const converges = await ctx.page.evaluate(() => (window as any).__test.parseConverged());
	if (!converges) {
		const [source, tree] = await Promise.all([
			ctx.editor.bridge.getSource(),
			ctx.page.evaluate(() => (window as any).__test.dumpTree())
		]);
		throw new Error(
			`[${ctx.label}] live CST diverges from a reparse of its serialization.\n` +
				`SOURCE: ${JSON.stringify(source)}\n--- CST ---\n${tree}`
		);
	}
}

export async function assertFocusBlock(
	ctx: SimContext,
	expectedBlockPath: number[]
): Promise<void> {
	const sel = await ctx.editor.bridge.getSelectionPaths();
	const actual = sel?.focus.path ?? null;
	if (!actual || !pathsEqual(actual, expectedBlockPath)) {
		throw new Error(
			`[${ctx.label}] click landed in the wrong block.\n` +
				`EXPECTED focus path: ${JSON.stringify(expectedBlockPath)}\n` +
				`ACTUAL focus path:   ${JSON.stringify(actual)}`
		);
	}
}

/**
 * Both selection endpoints resolve to a live CST node, with leaf offsets within
 * that node's raw. A structural gesture that mutates the tree can leave an endpoint
 * addressing a node that no longer exists or an offset past a now-shorter block —
 * a dangling selection the next keystroke dereferences into corruption. Walks the
 * live tree (not a reparse) against the public selection snapshot, so it catches a
 * stale endpoint the source-string oracles are blind to. A null selection (nothing
 * focused) is vacuously valid; only leaves carry the offset bound (container offsets
 * index children, a different space).
 */
export async function assertSelectionValidity(ctx: SimContext): Promise<void> {
	const invalid = await ctx.page.evaluate(() => {
		const probe = (window as any).__test;
		const sel = probe.getSelectionPaths();
		if (!sel) return null;
		const doc = probe.getDocument();
		const resolve = (path: number[]): { raw: unknown; isLeaf: boolean } | null => {
			let node: { children?: unknown[]; raw?: unknown } = doc;
			for (const index of path) {
				const children = node.children;
				if (!Array.isArray(children) || index < 0 || index >= children.length) return null;
				node = children[index] as { children?: unknown[]; raw?: unknown };
			}
			const children = node.children;
			return { raw: node.raw, isLeaf: !Array.isArray(children) || children.length === 0 };
		};
		for (const which of ['anchor', 'focus'] as const) {
			const point = sel[which];
			if (point.offset < 0) return { which, reason: 'negative offset', point };
			const resolved = resolve(point.path);
			if (!resolved) return { which, reason: 'path resolves to no live node', point };
			if (
				resolved.isLeaf &&
				typeof resolved.raw === 'string' &&
				point.offset > resolved.raw.length
			) {
				return {
					which,
					reason: 'offset exceeds leaf raw length',
					point,
					rawLength: resolved.raw.length
				};
			}
		}
		return null;
	});
	if (invalid) {
		throw new Error(`[${ctx.label}] selection endpoint invalid: ${JSON.stringify(invalid)}`);
	}
}

/**
 * The oracle sweep the destructive cross-block and merge gestures run at the moment
 * the tree is most likely corrupted — right after a range collapse or a merge, before
 * the next gesture builds on it. Bundles the note-agnostic structural oracles;
 * parse-convergence stays with the caller because its waiver lives on the note.
 */
export async function assertStructuralIntegrity(ctx: SimContext): Promise<void> {
	await assertNoErrors(ctx);
	await assertContainerParity(ctx);
	await assertNestedStateConsistent(ctx);
	await assertRoundTripStable(ctx);
	await assertSelectionValidity(ctx);
}

// ── History oracle ──────────────────────────────────────────────────────────

/**
 * Wraps a gesture in its own undo batch and asserts exact undo + redo. The
 * input batcher coalesces keystrokes within ~250ms, so the gesture must be
 * fenced by batch flushes on both sides or Ctrl+Z would overshoot into the
 * prior batch and false-positive. Leaves the editor in the post-gesture state
 * and resyncs the tracker to it.
 */
export async function undoRedoDifferential(
	ctx: SimContext,
	gesture: () => Promise<void>
): Promise<void> {
	await ctx.editor.waitForUndoBatchFlush();
	const before = await ctx.editor.bridge.getSource();
	await gesture();
	await ctx.editor.waitForUndoBatchFlush();
	const after = await ctx.editor.bridge.getSource();

	await ctx.editor.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000).catch(async () => {
		throw new Error(
			`[${ctx.label}] undo did not restore.\n` +
				`BEFORE: ${JSON.stringify(before)}\n` +
				`GOT:    ${JSON.stringify(await ctx.editor.bridge.getSource())}`
		);
	});

	await ctx.editor.redo();
	await ctx.editor.bridge.waitForSourceEquals(after, 3000).catch(async () => {
		throw new Error(
			`[${ctx.label}] redo did not re-apply.\n` +
				`AFTER: ${JSON.stringify(after)}\n` +
				`GOT:   ${JSON.stringify(await ctx.editor.bridge.getSource())}`
		);
	});

	ctx.tracker.resync(after);
}

// ── Internal ────────────────────────────────────────────────────────────────

function pathsEqual(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function describeDiff(expected: string, actual: string): string {
	let i = 0;
	const max = Math.min(expected.length, actual.length);
	while (i < max && expected[i] === actual[i]) i++;
	const context = 16;
	const slice = (s: string) => JSON.stringify(s.slice(Math.max(0, i - context), i + context));
	return `first divergence at index ${i}:\n  expected …${slice(expected)}…\n  actual   …${slice(actual)}…`;
}
