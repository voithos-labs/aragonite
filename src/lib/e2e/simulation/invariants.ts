import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';
import type { ExpectationTracker } from './expectation';
import type { ErrorCollector } from './error-collector';
import type { ImeDriver } from './ime';
import { getContainerParityMismatches } from '../container-parity';

export interface SimContext {
	page: Page;
	editor: EditorPage;
	tracker: ExpectationTracker;
	errors: ErrorCollector;
	label: string;
	/** Present only for sessions that drive IME composition: one driver made per session and
	 *  passed along, never a global. The composition gestures throw loudly when it is absent. */
	ime?: ImeDriver;
}

// ── Content checks ──────────────────────────────────────────────────────────

/**
 * The main per-keystroke check on the text. Fails with expected against actual plus the debug
 * dumps, never a bare timeout: a dropped or reordered character has to show up straight away.
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

// ── Structural and consistency checks ───────────────────────────────────────

export async function assertNoErrors(ctx: SimContext): Promise<void> {
	await ctx.errors.assertNone();
}

/**
 * Catches a mutation that extends `children` without `childIds`, which leaves trailing
 * keyed-each entries with undefined keys. Run at each checkpoint, so it shows up before a render
 * throws. The walk throws when no editor registered a document, so an empty walk fails loudly
 * instead of passing for nothing.
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
 * Catches a gesture that left the live tree disagreeing with its own raw text. The round-trip
 * check above only proves the source string is a fixed point; this compares the live tree with
 * a reparse of what it serializes to. Run at checkpoints, not per keystroke.
 */
export async function assertParseConvergence(ctx: SimContext): Promise<void> {
	const converges = await ctx.editor.parseConverged();
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
 * Catches a selection endpoint pointing nowhere: a node that no longer exists, or an offset past
 * a block that got shorter, which the next keystroke turns into corruption. Walks the live tree,
 * not a reparse, so it sees what the source-string checks cannot. A null selection is fine, and
 * only leaves bound the offset, since a container's offset counts children.
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
 * The structural checks, run right after a range collapse or a merge, when the tree is likeliest
 * to be corrupt and before the next gesture builds on it. Parse convergence stays with the
 * caller, since its waiver belongs to the note.
 */
export async function assertStructuralIntegrity(ctx: SimContext): Promise<void> {
	await assertNoErrors(ctx);
	await assertContainerParity(ctx);
	await assertNestedStateConsistent(ctx);
	await assertRoundTripStable(ctx);
	await assertSelectionValidity(ctx);
}

/**
 * The one set of checks a checkpoint runs: the structural ones plus parse convergence. A note
 * whose gestures leave the tree legitimately unconverged waives that part, and says why.
 */
export async function assertCheckpoint(
	ctx: SimContext,
	label: string,
	{ parseConvergence = true }: { parseConvergence?: boolean } = {}
): Promise<void> {
	ctx.label = label;
	await assertStructuralIntegrity(ctx);
	if (parseConvergence) await assertParseConvergence(ctx);
}

// ── Undo and redo check ─────────────────────────────────────────────────────

/**
 * The input batcher groups keystrokes within about 250ms, so the gesture is flushed on both
 * sides; without that, one Ctrl+Z reaches back into the previous batch and the check reports a
 * failure that is not real.
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

/**
 * Run `gesture` as an undo entry of its own, undo it, and wait for the bytes to come back, so
 * the tracker resumes exactly where it was. A detour that draws from the seed draws before
 * calling this, which keeps each seed's sequence of draws unchanged.
 */
export async function revertingDetour(
	ctx: SimContext,
	gesture: () => Promise<void>
): Promise<void> {
	const before = await ctx.editor.bridge.getSource();
	await ctx.editor.waitForUndoBatchFlush();
	await gesture();
	await ctx.editor.waitForUndoBatchFlush();
	await ctx.editor.undo();
	await ctx.editor.bridge.waitForSourceEquals(before, 3000);
	ctx.tracker.resync(before);
}

// ── Gestures whose result is read back, not predicted ───────────────────────

/**
 * Run `act`, wait for the source to change, and take the new source as the expected one. For a
 * gesture whose bytes the tracker cannot work out; one that changes nothing times out and throws.
 */
export async function actThenResync(ctx: SimContext, act: () => Promise<void>): Promise<string> {
	const before = await ctx.editor.bridge.getSource();
	await act();
	await ctx.editor.bridge.waitForSourceWith((source, prev) => source !== prev, before);
	await ctx.editor.waitForRenderFlush();
	const after = await ctx.editor.bridge.getSource();
	ctx.tracker.resync(after);
	return after;
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
