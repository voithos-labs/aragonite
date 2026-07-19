/**
 * Dev-mode performance counters for the profiling harness. A leaf module like
 * invariants/ — imports only core types, so the seams that record into it can
 * depend on it from anywhere. Recording is off until an explicit runtime
 * switch that itself only arms in dev/Vitest, so production builds and
 * non-profiling dev runs pay one boolean check per record call. Internal —
 * never exported from the editor barrel.
 */
import type { DocumentView } from '../core/node-views';

declare const process: { env?: Record<string, string | undefined> } | undefined;

export interface PerfSnapshot {
	snapshotCount: number;
	snapshotCloneBytes: number;
	rebuildDepths: Record<number, number>;
	parseCount: number;
	parseMsTotal: number;
	parseBlockCount: number;
	inlineComputeCount: number;
	undoLiveBytes: number;
	undoEntryCount: number;
	blockRenderCount: number;
	blockRenderMsTotal: number;
	keystrokeInPageMs: number[];
	blockRenderPaths: string[];
	mountedBlockCount: number;
	decorationRuns: number;
	islandRebuilds: number;
	islandKeyScans: number;
}

let enabled = false;
let counters = emptySnapshot();
let keystrokeStart: number | null = null;

function emptySnapshot(): PerfSnapshot {
	return {
		snapshotCount: 0,
		snapshotCloneBytes: 0,
		rebuildDepths: {},
		parseCount: 0,
		parseMsTotal: 0,
		parseBlockCount: 0,
		inlineComputeCount: 0,
		undoLiveBytes: 0,
		undoEntryCount: 0,
		blockRenderCount: 0,
		blockRenderMsTotal: 0,
		keystrokeInPageMs: [],
		blockRenderPaths: [],
		mountedBlockCount: 0,
		decorationRuns: 0,
		islandRebuilds: 0,
		islandKeyScans: 0
	};
}

// ── Switch and readout ──────────────────────────────────────────────────────

export function enablePerfInstruments(): void {
	if (import.meta.env.DEV || (typeof process !== 'undefined' && process?.env?.VITEST)) {
		enabled = true;
	}
}

export function disablePerfInstruments(): void {
	enabled = false;
}

export function resetPerfInstruments(): void {
	counters = emptySnapshot();
	keystrokeStart = null;
}

export function perfEnabled(): boolean {
	return enabled;
}

export function perfSnapshot(): PerfSnapshot {
	return {
		...counters,
		rebuildDepths: { ...counters.rebuildDepths },
		keystrokeInPageMs: [...counters.keystrokeInPageMs],
		blockRenderPaths: [...counters.blockRenderPaths]
	};
}

// ── Recorders ───────────────────────────────────────────────────────────────

export function recordSnapshotClone(bytes: number): void {
	if (!enabled) return;
	counters.snapshotCount++;
	counters.snapshotCloneBytes += bytes;
}

export function recordRebuildDepth(depth: number): void {
	if (!enabled) return;
	counters.rebuildDepths[depth] = (counters.rebuildDepths[depth] ?? 0) + 1;
}

export function recordParse(ms: number, blockCount: number): void {
	if (!enabled) return;
	counters.parseCount++;
	counters.parseMsTotal += ms;
	counters.parseBlockCount += blockCount;
}

export function recordInlineCompute(): void {
	if (!enabled) return;
	counters.inlineComputeCount++;
}

export function setUndoGauge(liveBytes: number, entryCount: number): void {
	if (!enabled) return;
	counters.undoLiveBytes = liveBytes;
	counters.undoEntryCount = entryCount;
}

export function recordBlockRender(ms: number, path?: number[]): void {
	if (!enabled) return;
	counters.blockRenderCount++;
	counters.blockRenderMsTotal += ms;
	if (path) counters.blockRenderPaths.push(path.join(','));
}

// One decoration source's provide() ran once. notifyEdit runs every source, so a
// typing pass records edits × sources — the ceiling that catches a per-block cascade.
export function recordDecorationRun(): void {
	if (!enabled) return;
	counters.decorationRuns++;
}

// The prose render path tore down and rebuilt an island-bearing block's islands.
export function recordIslandRebuild(): void {
	if (!enabled) return;
	counters.islandRebuilds++;
}

// The island key handler walked a text block's DOM for islands (one querySelectorAll
// per destructive/printable keystroke, even when the block holds none).
export function recordIslandKeyScan(): void {
	if (!enabled) return;
	counters.islandKeyScans++;
}

export function incMountedBlocks(): void {
	if (!enabled) return;
	counters.mountedBlockCount++;
}

export function decMountedBlocks(): void {
	if (!enabled) return;
	counters.mountedBlockCount--;
}

export function markKeystrokeStart(): void {
	if (!enabled) return;
	keystrokeStart = performance.now();
}

export function markKeystrokeSettle(): void {
	if (!enabled || keystrokeStart === null) return;
	counters.keystrokeInPageMs.push(performance.now() - keystrokeStart);
	keystrokeStart = null;
}

/**
 * Serialized-byte proxy without building the string: document serialization
 * is prefix + Σ(leadingTrivia + raw) + suffix. Counts UTF-16 code units —
 * exact vs `serialize().length`, approximate vs on-disk bytes for non-ASCII.
 */
export function docByteLength(doc: DocumentView): number {
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}
