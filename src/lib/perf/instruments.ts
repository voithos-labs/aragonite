/**
 * Dev-mode performance counters for the profiling harness. A leaf module like
 * invariants/ — imports only core types, so the seams that record into it can
 * depend on it from anywhere. Recording is off until an explicit runtime
 * switch that itself only arms in dev/Vitest, so production builds and
 * non-profiling dev runs pay one boolean check per record call. Internal —
 * never exported from the editor barrel.
 */
import type { Document } from '../core/nodes';

declare const process: { env?: Record<string, string | undefined> } | undefined;

export interface PerfSnapshot {
	snapshotCount: number;
	snapshotCloneBytes: number;
	rebuildDepths: Record<number, number>;
	parseCount: number;
	parseMsTotal: number;
	parseBlockCount: number;
	inlineRefreshCount: number;
	inlineRefreshNodeCount: number;
	undoLiveBytes: number;
	undoEntryCount: number;
}

let enabled = false;
let counters = emptySnapshot();

function emptySnapshot(): PerfSnapshot {
	return {
		snapshotCount: 0,
		snapshotCloneBytes: 0,
		rebuildDepths: {},
		parseCount: 0,
		parseMsTotal: 0,
		parseBlockCount: 0,
		inlineRefreshCount: 0,
		inlineRefreshNodeCount: 0,
		undoLiveBytes: 0,
		undoEntryCount: 0
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
}

export function perfEnabled(): boolean {
	return enabled;
}

export function perfSnapshot(): PerfSnapshot {
	return { ...counters, rebuildDepths: { ...counters.rebuildDepths } };
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

export function recordInlineRefresh(nodeCount: number): void {
	if (!enabled) return;
	counters.inlineRefreshCount++;
	counters.inlineRefreshNodeCount += nodeCount;
}

export function setUndoGauge(liveBytes: number, entryCount: number): void {
	if (!enabled) return;
	counters.undoLiveBytes = liveBytes;
	counters.undoEntryCount = entryCount;
}

/**
 * Serialized-byte proxy without building the string: document serialization
 * is prefix + Σ(leadingTrivia + raw) + suffix.
 */
export function docByteLength(doc: Document): number {
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}
