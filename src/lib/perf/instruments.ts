/**
 * Dev-mode performance counters for the profiling harness. It depends only on the build flags,
 * so anything that records into it can import it. Recording stays off until a runtime switch that
 * turns on only in a dev build or a test run, leaving production one boolean check per record
 * call. Internal: never exported from the editor barrel.
 */
import { editorEnv, isDevChecks } from '../env';
import type { DocumentView } from '../core/node-views';

export interface PerfSnapshot {
	snapshotCount: number;
	snapshotCloneBytes: number;
	rebuildDepths: Record<number, number>;
	/** Parses of a rebuilt container's own bytes, to re-derive its kind or metadata
	 *  (`schema/container-raw.ts :: parseContainerRaw`), and the bytes they read. */
	containerKindReparses: number;
	containerReparseBytes: number;
	/** Reads of a rebuilt container's first line alone, to re-derive its kind or metadata. */
	openerLineReads: number;
	/** Lines a quote or list item rebuild read through its line syntax, each reading counted. */
	stripLinesRead: number;
	parseCount: number;
	parseMsTotal: number;
	parseBlockCount: number;
	/** Bytes every block parse read; what a keystroke's join ask costs. */
	parseBytes: number;
	inlineComputeCount: number;
	/** Inline-format coverage reads that actually parsed: what a toolbar's pressed state costs. */
	formatCoverageReads: number;
	/** Renders of inline content read back for what the screen shows: what a hidden edge costs. */
	screenReads: number;
	undoLiveBytes: number;
	undoEntryCount: number;
	blockRenderCount: number;
	blockRenderMsTotal: number;
	keystrokeInPageMs: number[];
	/** From the first repaint request of a task to the drawn caret's paint, one entry per paint. */
	caretPaintMs: number[];
	/** Paints at an animation frame that moved the drawn caret: a move no caret write asked for. */
	caretFrameMoves: number;
	/** Every paint of the drawn caret, at a frame or not; a page scroll should cost none. */
	caretPaints: number;
	/** Answers the caret's look computed rather than found in its cache: one per change, not per paint. */
	caretLookComputes: number;
	/** Inline nodes the look examined to find the constructs around the caret. */
	caretLookNodeVisits: number;
	/** Reads of the caret's raw offset from the DOM the look made. */
	caretLookOffsetWalks: number;
	/** Dry runs of the next insertion the look made, and the parses of their results. */
	caretLookPreviews: number;
	caretLookParses: number;
	blockRenderPaths: string[];
	mountedBlockCount: number;
	decorationRuns: number;
	islandRebuilds: number;
	islandKeyScans: number;
	/** One entry per windowing height table built: the list's path and the width it estimated at. */
	heightTableBuilds: { path: string; width: number }[];
	/** Checks of whether a change moved the focused block past a neighbour, which only a rebuilt
	 *  height table pays for. */
	neighbourPasses: number;
}

let enabled = false;
let counters = emptySnapshot();
let keystrokeStart: number | null = null;
let caretRequestedAt: number | null = null;

function emptySnapshot(): PerfSnapshot {
	return {
		snapshotCount: 0,
		snapshotCloneBytes: 0,
		rebuildDepths: {},
		containerKindReparses: 0,
		containerReparseBytes: 0,
		openerLineReads: 0,
		stripLinesRead: 0,
		parseCount: 0,
		parseMsTotal: 0,
		parseBlockCount: 0,
		parseBytes: 0,
		inlineComputeCount: 0,
		formatCoverageReads: 0,
		screenReads: 0,
		undoLiveBytes: 0,
		undoEntryCount: 0,
		blockRenderCount: 0,
		blockRenderMsTotal: 0,
		keystrokeInPageMs: [],
		caretPaintMs: [],
		caretFrameMoves: 0,
		caretPaints: 0,
		caretLookComputes: 0,
		caretLookNodeVisits: 0,
		caretLookOffsetWalks: 0,
		caretLookPreviews: 0,
		caretLookParses: 0,
		blockRenderPaths: [],
		mountedBlockCount: 0,
		decorationRuns: 0,
		islandRebuilds: 0,
		islandKeyScans: 0,
		heightTableBuilds: [],
		neighbourPasses: 0
	};
}

// ── Switch and readout ──────────────────────────────────────────────────────

export function enablePerfInstruments(): void {
	if (isDevChecks() || editorEnv.isTest) enabled = true;
}

export function disablePerfInstruments(): void {
	enabled = false;
}

export function resetPerfInstruments(): void {
	counters = emptySnapshot();
	keystrokeStart = null;
	caretRequestedAt = null;
}

export function perfEnabled(): boolean {
	return enabled;
}

export function perfSnapshot(): PerfSnapshot {
	return {
		...counters,
		rebuildDepths: { ...counters.rebuildDepths },
		keystrokeInPageMs: [...counters.keystrokeInPageMs],
		caretPaintMs: [...counters.caretPaintMs],
		blockRenderPaths: [...counters.blockRenderPaths],
		heightTableBuilds: [...counters.heightTableBuilds]
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

export function recordContainerKindReparse(bytes: number): void {
	if (!enabled) return;
	counters.containerKindReparses++;
	counters.containerReparseBytes += bytes;
}

export function recordOpenerLineRead(): void {
	if (!enabled) return;
	counters.openerLineReads++;
}

export function recordStripLinesRead(lines: number): void {
	if (!enabled) return;
	counters.stripLinesRead += lines;
}

export function recordParse(ms: number, blockCount: number, bytes: number): void {
	if (!enabled) return;
	counters.parseCount++;
	counters.parseMsTotal += ms;
	counters.parseBlockCount += blockCount;
	counters.parseBytes += bytes;
}

export function recordInlineCompute(): void {
	if (!enabled) return;
	counters.inlineComputeCount++;
}

export function recordFormatCoverageRead(): void {
	if (!enabled) return;
	counters.formatCoverageReads++;
}

export function recordScreenRead(): void {
	if (!enabled) return;
	counters.screenReads++;
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

// `notifyEdit` runs every source, so a typing pass records keystrokes × sources, the ceiling
// that catches one block's change cascading into the rest.
export function recordDecorationRun(): void {
	if (!enabled) return;
	counters.decorationRuns++;
}

export function recordIslandRebuild(): void {
	if (!enabled) return;
	counters.islandRebuilds++;
}

// One `querySelectorAll` per delete or printable keystroke, even when the block has none.
export function recordIslandKeyScan(): void {
	if (!enabled) return;
	counters.islandKeyScans++;
}

export function recordHeightTableBuild(path: readonly number[], width: number): void {
	if (!enabled) return;
	counters.heightTableBuilds.push({ path: path.join(','), width });
}

export function recordNeighbourPass(): void {
	if (!enabled) return;
	counters.neighbourPasses++;
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

export function markCaretRequest(): void {
	if (!enabled || caretRequestedAt !== null) return;
	caretRequestedAt = performance.now();
}

export function recordCaretFrameMove(): void {
	if (!enabled) return;
	counters.caretFrameMoves++;
}

export function countCaretPaint(): void {
	if (!enabled) return;
	counters.caretPaints++;
}

/** One unit of the drawn caret's look work, by the counter it falls under. */
export function recordCaretLook(
	what:
		| 'caretLookComputes'
		| 'caretLookNodeVisits'
		| 'caretLookOffsetWalks'
		| 'caretLookPreviews'
		| 'caretLookParses'
): void {
	if (!enabled) return;
	counters[what]++;
}

export function markCaretPaint(): void {
	if (!enabled || caretRequestedAt === null) return;
	counters.caretPaintMs.push(performance.now() - caretRequestedAt);
	caretRequestedAt = null;
}

/**
 * A stand-in for the serialized byte count that never builds the string. Counts UTF-16 code
 * units: exact against `serialize().length`, approximate against on-disk bytes for non-ASCII.
 */
export function docByteLength(doc: DocumentView): number {
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}
