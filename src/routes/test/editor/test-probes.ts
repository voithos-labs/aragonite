import type { Editor, PastedImage, PresentationMode } from '$lib';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseConverges } from '$lib/testing/parse-convergence';
import { parseInline, getContentRange, isProseKind } from '$lib/core/inline';
import { findBlockPathForElement } from '$lib/selection/path-lookup';
import { isBlockNode, nodeAt } from '$lib/tree-operations/node-ops';
import { spliceChildren } from '$lib/tree-operations/children';
import { getStateForNode } from '$lib/reactivity/state-registry';
import type { BlockKind, CstNode, Document } from '$lib/core/nodes';
import type { EditorSelection } from '$lib/selection/primitives';
import type { DecorationSource, DecorationSourceHandle } from '$lib/decorations/types';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import {
	getAllRegisteredKinds,
	getBlockKindDescriptor,
	registerBlockKind,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { registerBlockComponent } from '$lib/schema/block-component-registry';
import {
	dumpTree,
	dumpUndoStack,
	dumpInlineTree,
	dumpOperationsLog,
	dumpInteractionTrace
} from '$lib/debug/inspect';
import { enablePerfInstruments, resetPerfInstruments, perfSnapshot } from '$lib/perf/instruments';
import {
	enableInteractionTrace,
	disableInteractionTrace,
	interactionTraceSnapshot
} from '$lib/debug/interaction-trace';
import type { ClosureBlock } from '$lib/schema/closure';
import ThrowOnRenderBlock from './ThrowOnRenderBlock.svelte';

type EditorInstance = ReturnType<typeof Editor>;

// These kinds only trip BlockHost fallback paths, never a real editing surface, so
// every cross-cutting system is honestly not-supported; mergeBackspace stays
// non-inherit to satisfy the not-mergeable coherence rule.
const HARNESS_PROBE_CLOSURE: ClosureBlock = {
	roundTrip: { mode: 'inherit-default' },
	focus: {
		mode: 'not-supported',
		reason: 'harness probe — a single BlockHost fallback path, not an editing surface'
	},
	mergeBackspace: { mode: 'not-supported', reason: 'harness probe — not a real editing surface' },
	selectionPaint: { mode: 'not-supported', reason: 'harness probe — visible-raw fallback' },
	searchPaint: { mode: 'not-supported', reason: 'harness probe — not exercised by search' },
	reorder: { mode: 'not-supported', reason: 'harness probe — not reorder-tested' },
	undo: { mode: 'not-supported', reason: 'harness probe — not undo-tested' },
	clipboard: { mode: 'not-supported', reason: 'harness probe — not clipboard-tested' },
	simOracle: { mode: 'not-supported', reason: 'harness probe — drives the fallback path only' }
};

export interface TestProbeDeps {
	editor: EditorInstance;
	setSource: (md: string) => void;
	setKeybindings: (overrides: KeybindingOverride[] | undefined) => void;
	setPresentationMode: (mode: PresentationMode) => void;
}

// ── Selection inspection (shared with the DebugPanel getters) ──────────────

// Prefers the range's container over document.activeElement so the path still
// resolves once focus moved to the panel; the last selection still points into the editor.
export function getFocusedBlockPath(): number[] | null {
	if (typeof window === 'undefined') return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const node = sel.getRangeAt(0).startContainer;
	const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
	return findBlockPathForElement(el);
}

export function dumpFocusedInlineTree(source: string): string {
	const path = getFocusedBlockPath();
	if (!path) return '';
	const doc = parse(source);
	const node = nodeAt(doc, path);
	if (!node || !isBlockNode(node) || !isProseKind(node.kind)) return '';
	const range = getContentRange(node);
	const inline = parseInline(node.raw, range.start, range.end);
	return dumpInlineTree(inline);
}

function isCrossBlockSnapshot(sel: {
	anchor: { path: number[] };
	focus: { path: number[] };
}): boolean {
	const a = sel.anchor.path;
	const f = sel.focus.path;
	if (a.length !== f.length) return true;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== f[i]) return true;
	}
	return false;
}

function describeNode(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return '#text';
	if (node.nodeType === Node.ELEMENT_NODE) {
		const el = node as Element;
		const cls =
			typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
		return el.tagName.toLowerCase() + cls;
	}
	return '#' + node.nodeType;
}

// editor.getSelection()'s cross-block branch only populates while SelectionState is
// active, so single-block carets fall back to reading the native selection.
export function liveSelectionText(editor: EditorInstance | undefined): string {
	const editorSel = editor?.getSelection();
	if (editorSel && isCrossBlockSnapshot(editorSel)) {
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		return `anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)} cross-block=true`;
	}
	if (typeof window === 'undefined') return '(no selection)';
	const nativeSel = window.getSelection();
	if (!nativeSel || nativeSel.rangeCount === 0) return '(no selection)';
	const range = nativeSel.getRangeAt(0);
	const startNode = range.startContainer;
	const endNode = range.endContainer;
	const startEl =
		startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
	const endEl = endNode.nodeType === Node.TEXT_NODE ? endNode.parentElement : (endNode as Element);
	const startPath = findBlockPathForElement(startEl);
	const endPath = findBlockPathForElement(endEl);
	if (!startPath || !endPath) return '(no selection in editor)';
	const lines = [
		`mode=single-block${range.collapsed ? ' (caret)' : ' (range)'}`,
		`anchor=[${startPath.join(',')}] focus=[${endPath.join(',')}]`,
		// Native Range offsets are child-index counts against startContainer/endContainer,
		// not raw offsets; the `raw:` line below carries the CST-coordinate values.
		`range: startContainer=${describeNode(range.startContainer)} startOffset=${range.startOffset} endContainer=${describeNode(range.endContainer)} endOffset=${range.endOffset}`
	];
	if (editorSel) {
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		lines.push(`raw: anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)}`);
	}
	if (!range.collapsed) {
		const selected = nativeSel.toString();
		if (selected) lines.push(`selected=${JSON.stringify(selected)}`);
	}
	return lines.join('\n');
}

// ── Conformance sweep entries (backs the browser sweep e2e) ────────────────

// The three closure columns the headless battery records as `boundary` — their
// mechanisms are mounted-DOM-only, so the browser sweep executes them per kind.
interface ConformanceSweepEntry {
	kind: string;
	fixture: string;
	// Drawn from the fixture's first text leaf and absent from the neighbour paragraphs
	// the sweep sandwiches it between, so a match is attributable to this block. Null
	// when the block carries no searchable text.
	token: string | null;
	cells: {
		focus: { mode: string };
		selectionPaint: { mode: string };
		searchPaint: { mode: string };
	};
}

function firstNodeOfKind(node: CstNode | Document, kind: string): CstNode | null {
	if ('kind' in node && node.kind === kind) return node as CstNode;
	for (const child of node.children ?? []) {
		const found = firstNodeOfKind(child, kind);
		if (found) return found;
	}
	return null;
}

// The LEAF's raw, not the node's own: a container's opener (`:::note`, `> `) is chrome
// the search never scans, so a token drawn from it would never paint.
function firstTextLeafToken(node: CstNode): string | null {
	if (node.children && node.children.length > 0) {
		for (const child of node.children) {
			const token = firstTextLeafToken(child);
			if (token) return token;
		}
		return null;
	}
	return node.raw.match(/[A-Za-z0-9]+/)?.[0] ?? null;
}

// One row per kind that declares a conformanceFixture, parsed in the ROUTE's registry:
// a fixture shadowed by another plugin's directive (admonition's `:::note` under the
// co-registered callout) carries a null token, so the sweep records that reachability
// gap rather than the bridge hiding it.
function collectConformanceEntries(): ConformanceSweepEntry[] {
	const entries: ConformanceSweepEntry[] = [];
	for (const kind of getAllRegisteredKinds()) {
		const descriptor = getBlockKindDescriptor(kind);
		const fixture = descriptor.conformanceFixture;
		if (fixture === undefined) continue;
		const node = firstNodeOfKind(parse(fixture), kind);
		entries.push({
			kind,
			fixture,
			token: node ? firstTextLeafToken(node) : null,
			cells: {
				focus: { mode: descriptor.closure.focus.mode },
				selectionPaint: { mode: descriptor.closure.selectionPaint.mode },
				searchPaint: { mode: descriptor.closure.searchPaint.mode }
			}
		});
	}
	// A sweep over zero rows asserts nothing about any kind. Loud beats vacuous.
	if (entries.length === 0) {
		throw new Error(
			'collectConformanceEntries: no registered kind declares a conformanceFixture; the browser sweep would run over an empty set'
		);
	}
	return entries;
}

// ── window.__test probe surface (backs the e2e suite) ──────────────────────

type ProbeRect = { top: number; left: number; width: number; height: number } | null;
type CaretProbeState = { captured: boolean; rect: ProbeRect };

// A session subscribes to ONE editor's events. The accumulator is module-level and
// survives a remount; the subscription does not, so reading afterwards would hand back
// a vacuous empty array — `invalidate` marks the session stale and the read throws.
function createSessionProbe<T>(init: () => T): {
	start: (subscribe: (accumulator: T) => () => void) => void;
	stop: () => T;
	peek: () => T;
	invalidate: (reason: string) => void;
} {
	let value = init();
	let dispose: (() => void) | undefined;
	let staleReason: string | undefined;
	const assertLive = () => {
		if (staleReason) throw new Error(`test probe session is dead: ${staleReason}`);
	};
	return {
		start(subscribe) {
			dispose?.();
			staleReason = undefined;
			value = init();
			dispose = subscribe(value);
		},
		stop() {
			assertLive();
			dispose?.();
			dispose = undefined;
			return value;
		},
		peek() {
			assertLive();
			return value;
		},
		invalidate(reason) {
			if (!dispose) return;
			dispose();
			dispose = undefined;
			staleReason = reason;
		}
	};
}

const editOpProbe = createSessionProbe<string[]>(() => []);
const errorProbe = createSessionProbe<string[]>(() => []);
const caretProbe = createSessionProbe<CaretProbeState>(() => ({ captured: false, rect: null }));
const selectionProbe = createSessionProbe<SelectionChangeRecord[]>(() => []);

/** One `selectionChange` payload, flattened so it survives `page.evaluate`. */
interface SelectionChangeRecord {
	anchor: { path: number[]; offset: number } | null;
	focus: { path: number[]; offset: number } | null;
}

// ── Image-paste host hook ──────────────────────────────────────────────────
//
// `onPasteImage` is set-once at mount, so the page installs THIS stable function
// (opted in with `?imagePaste=on`) and a spec swaps what it answers behind it, instead
// of remounting per arm. Responses are consumed one per image; the last one repeats.

interface ImagePasteResponse {
	/** Markdown to insert; omitted or null exercises the skip-this-image arm. */
	markdown?: string | null;
	reject?: boolean;
	/** Stay pending until `release()`, so a spec can move the caret mid-import. */
	hold?: boolean;
}

interface ImagePasteCall {
	mimeType: string;
	suggestedName: string | null;
	bytes: number;
}

let imagePasteResponses: ImagePasteResponse[] = [];
const imagePasteCalls: ImagePasteCall[] = [];
let releaseHeldImport: (() => void) | null = null;

export async function harnessPasteImage(image: PastedImage): Promise<string | null> {
	const response = imagePasteResponses[
		Math.min(imagePasteCalls.length, imagePasteResponses.length - 1)
	] ?? { markdown: null };
	imagePasteCalls.push({
		mimeType: image.mimeType,
		suggestedName: image.suggestedName ?? null,
		bytes: image.blob.size
	});
	if (response.hold) await new Promise<void>((resolve) => (releaseHeldImport = resolve));
	if (response.reject) throw new Error('harness image import rejected');
	return response.markdown ?? null;
}

let capturedBlockRef: ReturnType<EditorInstance['__test']['getBlockComponent']> = null;
// Handles kept by source name so a spec can dispose/invalidate a source it
// registered — the returned handle carries functions and can't cross page.evaluate.
const decorationHandles = new Map<string, DecorationSourceHandle>();

// Installs the e2e probe surface on `window.__test`. Behavior must stay
// byte-for-byte stable — the e2e suite drives the editor through these.
export function installTestProbes({
	editor,
	setSource,
	setKeybindings,
	setPresentationMode
}: TestProbeDeps): void {
	if (typeof window === 'undefined' || !editor) return;

	// A reinstall means a new editor instance; any session still open belongs to the
	// old one's emitter and can no longer observe anything.
	const remounted = 'the editor remounted while the session was open';
	editOpProbe.invalidate(remounted);
	errorProbe.invalidate(remounted);
	caretProbe.invalidate(remounted);
	selectionProbe.invalidate(remounted);

	// Unfiltered: the requirement files claim "exactly one edit event per user gesture"
	// without qualification, so a filter would let a second commit leg count zero.
	const subscribeEditOps = (ops: string[]): (() => void) =>
		editor.getEvents().on('edit', (e: { op: string }) => {
			ops.push(e.op);
		});

	(window as any).__test = {
		getSource: () => editor.getSource(),
		getDocument: () => editor.__test.getDocument(),
		setSource: (md: string) => {
			setSource(md);
		},
		setKeybindings: (overrides: KeybindingOverride[] | undefined) => {
			setKeybindings(overrides);
		},
		// Flips the live prop with no DOM focus change, the one path that exercises the
		// editor's mode-reconcile of data-focused (the header toggles blur instead).
		setPresentationMode: (mode: PresentationMode) => {
			setPresentationMode(mode);
		},
		// getBlockCount / getBlockKind / dumpTree read the LIVE CST, not parse(getSource()):
		// a reparse can't see a live-kind-vs-raw desync or a transient block the serializer
		// trims. (dumpInlineTree stays on the reparse — inline structure, not liveness.)
		getBlockCount: () => editor.__test.getDocument().children.length,
		// Fires a nested container scope's windowing rebuild WITHOUT moving the scroll (the
		// VR-2 above-fold anchor-remap path), unlike setSource or undo. Root paths are
		// rejected: root ids live in a separate `blockIds` array this helper can't reach.
		// Ancestor raw stays STALE, so assert through getDocument() or parseConverged(),
		// never getSource()/roundTripStable().
		spliceContainerChildren: (
			path: number[],
			at: number,
			removeCount: number,
			markdown: string
		): void => {
			if (path.length === 0) return;
			const container = nodeAt(editor.__test.getDocument(), path) as CstNode | null;
			if (!container) return;
			const inserted = markdown ? parse(markdown).children : [];
			spliceChildren(container, at, removeCount, ...inserted);
			container.children = [...(container.children ?? [])];
		},
		getBlockKind: (index: number) => editor.__test.getDocument().children[index]?.kind ?? '',
		getConformanceEntries: (): ConformanceSweepEntry[] => collectConformanceEntries(),
		// A descriptor with NO registered component reaches BlockHost's no-component branch
		// and its visible-raw fallback. The kind stays outside ALL_BLOCK_KINDS so the
		// startup registry-completeness check is unperturbed.
		makeBlockOrphan: (index: number): void => {
			const kind = 'orphanTest' as BlockKind;
			if (!tryGetBlockKindDescriptor(kind)) {
				registerBlockKind(kind, {
					mergeRole: 'not-mergeable',
					editable: true,
					supportsInline: false,
					closure: HARNESS_PROBE_CLOSURE
				});
			}
			const doc = editor.__test.getDocument();
			const node = doc.children[index] as CstNode | undefined;
			if (!node) return;
			node.kind = kind;
			doc.children = [...doc.children];
		},
		// A component that throws during render reaches BlockHost's <svelte:boundary>
		// failed-snippet path.
		makeBlockThrowOnRender: (index: number): void => {
			const kind = 'throwTest' as BlockKind;
			if (!tryGetBlockKindDescriptor(kind)) {
				registerBlockKind(kind, {
					mergeRole: 'not-mergeable',
					editable: false,
					supportsInline: false,
					closure: HARNESS_PROBE_CLOSURE
				});
				// A throwing stub isn't a full BlockComponent, but it throws before any
				// method is read.
				registerBlockComponent(kind, {
					component: ThrowOnRenderBlock as unknown as Parameters<
						typeof registerBlockComponent
					>[1]['component']
				});
			}
			const doc = editor.__test.getDocument();
			const node = doc.children[index] as CstNode | undefined;
			if (!node) return;
			node.kind = kind;
			doc.children = [...doc.children];
		},
		// Reads SelectionState, never the deferred `data-cross-block` DOM mirror: the lag
		// turns every `false` assertion into a false pass, and the mirror is document-global
		// (wrong editor on a two-editor route). Same rule `editor-rects.ts` carries.
		isCrossBlockActive: (): boolean => editor.__test.isCrossBlockActive(),
		// Narrower than the mode above: an intra-table rectangle turns that on while both
		// endpoints keep the table's own path.
		isCrossBlockSelection: (): boolean => {
			const sel = editor?.getSelection();
			if (!sel) return false;
			return isCrossBlockSnapshot(sel);
		},
		getSelectionPaths: () => {
			const sel = editor?.getSelection();
			if (!sel) return null;
			return {
				anchor: { path: sel.anchor.path, offset: sel.anchor.offset },
				focus: { path: sel.focus.path, offset: sel.focus.offset }
			};
		},
		// Faithful mirrors, unlike getSelectionPaths above: a round-trip spec must hand back
		// the endpoint UNION variant it got, and the path-only projection drops `cellCoordinate`.
		getSelection: (): EditorSelection | null => editor.getSelection(),
		setSelection: (selection: EditorSelection): Promise<boolean> => editor.setSelection(selection),
		roundTripStable: (): boolean => {
			const src = editor.getSource();
			return serialize(parse(src)) === src;
		},
		// The live-tree convergence oracle. roundTripStable above is a tautology as a
		// mutation oracle (serialize(parse(s)) === s holds for all valid GFM); this compares
		// the LIVE CST against a reparse of its own serialization, so a tree left diverging
		// from its raw (stale kind, stale grid, split-separator drift) is caught.
		parseConverged: (): boolean => parseConverges(editor.__test.getDocument()),
		// The bar shows a match count instead of "N replaced" whenever matches survive a
		// replace (skipped container matches), so specs read the replaced count here.
		getSearchReplacedCount: (): number | null => editor.getSearch().replacedCount,
		// ── Image-paste hook knob (the hook itself is installed by the page) ──
		imagePaste: {
			setResponses: (responses: ImagePasteResponse[]): void => {
				imagePasteResponses = responses;
			},
			release: (): void => {
				releaseHeldImport?.();
				releaseHeldImport = null;
			},
			getCalls: (): ImagePasteCall[] => [...imagePasteCalls],
			reset: (): void => {
				imagePasteResponses = [];
				imagePasteCalls.length = 0;
				releaseHeldImport = null;
			}
		},
		// ── Decoration source probe (register sources without a plugin) ────
		decorations: {
			addSource: (source: DecorationSource): void => {
				decorationHandles.set(source.name, editor.getDecorations().addSource(source));
			},
			disposeSource: (name: string): void => {
				decorationHandles.get(name)?.dispose();
				decorationHandles.delete(name);
			},
			invalidateSource: (name: string): void => {
				decorationHandles.get(name)?.invalidate();
			}
		},
		// ── Rect API probe (drives editor.getRects() from e2e) ─────────────
		// DOMRects don't survive page.evaluate as class instances, so each spec extracts
		// the numeric fields it needs inside its own evaluate.
		rects: {
			blockRect: (path: number[]): DOMRect | null => editor.getRects().blockRect(path),
			rangeRects: (path: number[], start: number, end: number): DOMRect[] =>
				editor.getRects().rangeRects(path, start, end),
			caretRect: (): DOMRect | null => editor.getRects().caretRect(),
			reveal: (path: number[]): Promise<boolean> => editor.getRects().reveal(path),
			scrollTo: (path: number[], opts?: { block?: 'nearest' | 'center' }): Promise<boolean> =>
				editor.getRects().scrollTo(path, opts)
		},
		// ── Cross-block caretRect timing probe ─────────────────────────────
		// Reads caretRect from INSIDE the synchronous handler, the window before the
		// deferred data-cross-block $effect runs, pinning that caretRect reads
		// SelectionState: the stale attribute would leak the parked cross-block range.
		startCrossBlockCaretProbe: (): void =>
			caretProbe.start((state) =>
				editor.getEvents().on('selectionChange', (sel) => {
					if (state.captured || !sel || !isCrossBlockSnapshot(sel)) return;
					const r = editor.getRects().caretRect();
					state.captured = true;
					state.rect = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
				})
			),
		readCrossBlockCaretProbe: (): { captured: boolean; rect: ProbeRect } => caretProbe.stop(),
		// ── selectionChange emission capture ──────────────────────────────
		// Every payload in order, so a spec can assert what a subscriber READS BACK
		// mid-gesture: the burst's shape, not only its settled last value.
		startSelectionChangeCapture: (): void =>
			selectionProbe.start((records) =>
				editor.getEvents().on('selectionChange', (sel) => {
					records.push({
						anchor: sel && { path: sel.anchor.path, offset: sel.anchor.offset },
						focus: sel && { path: sel.focus.path, offset: sel.focus.offset }
					});
				})
			),
		stopSelectionChangeCapture: (): SelectionChangeRecord[] => selectionProbe.stop(),
		// ── Perf instruments surface ──────────────────────────────────────
		perf: {
			enable: enablePerfInstruments,
			reset: resetPerfInstruments,
			snapshot: perfSnapshot
		},
		// ── Interaction-trace surface ─────────────────────────────────────
		trace: {
			enable: enableInteractionTrace,
			disable: disableInteractionTrace,
			snapshot: interactionTraceSnapshot
		},
		// ── Consumer diagnostics door (real, not the extracted builder) ────
		// Through the actual door, so the includeSource `?? false` default is exercised
		// where it lives.
		serializeDiagnostics: (opts?: { includeSource?: boolean }) =>
			editor.getDiagnostics().serializeDiagnostics(opts),
		// ── Debug engine surface ──────────────────────────────────────────
		dumpTree: (opts?: Parameters<typeof dumpTree>[1]) =>
			dumpTree(editor.__test.getDocument(), opts),
		dumpSelection: () => liveSelectionText(editor),
		dumpInlineTree: () => dumpFocusedInlineTree(editor.getSource()),
		dumpUndoStack: (n = 10) => dumpUndoStack(editor.__test.getUndoStack(), n),
		dumpOperationsLog: (n = 20) => dumpOperationsLog(editor.__test.getOperationsLog(), n),
		dumpInteractionTrace: (n = 50) => dumpInteractionTrace(interactionTraceSnapshot(), n),
		// ── Edit-event capture / counting probes ──────────────────────────
		// startEditCount and startEditOpCapture share one accumulator (a count is its
		// length), so no spec may run both at once; a second start replaces the first.
		startEditCount: (): void => editOpProbe.start(subscribeEditOps),
		stopEditCount: (): number => editOpProbe.stop().length,
		startEditOpCapture: (): void => editOpProbe.start(subscribeEditOps),
		stopEditOpCapture: (): string[] => editOpProbe.stop(),
		// ── Error-event capture probe ─────────────────────────────────────
		// Subscribes to the same EditorEvents instance BlockHost emits to, so a caught
		// render failure surfaces here.
		startErrorCapture: (): void =>
			errorProbe.start((origins) =>
				editor.getEvents().on('error', (e) => {
					origins.push(e.origin);
				})
			),
		getCapturedErrors: (): string[] => errorProbe.peek(),
		// ── List item id probe ────────────────────────────────────────────
		getListItemIds: (blockIndex: number): string[] => {
			const doc = editor.__test.getDocument();
			const node = doc.children[blockIndex] as CstNode | undefined;
			if (!node) return [];
			const state = getStateForNode(node);
			return state ? [...state.innerBlockIds] : [];
		},
		// ── Stale ref-slot probes ────────────────────────────────────────
		/**
		 * Forges the stale detached ref the windowed each-block's conditional cleanup
		 * only rarely leaves behind: capture the mounted component here, then write it
		 * back into a cleared slot via `replantBlockRef`.
		 */
		captureBlockRef: (index: number): boolean => {
			capturedBlockRef = editor.__test.getBlockComponent([index]);
			return capturedBlockRef !== null;
		},
		replantBlockRef: (index: number): boolean => {
			if (!capturedBlockRef) return false;
			editor.__test.setBlockRefSlot(index, capturedBlockRef);
			return true;
		},
		// ── BlockComponent surface probe ─────────────────────────────────
		/**
		 * The public `BlockComponent` caret doors a plugin-authored container calls
		 * directly, unreachable from gesture-level specs (every built-in caret placement
		 * goes through a pointer or keyboard path first). `parkCaret` is optional on the
		 * contract, so its probe reports false rather than falling back to the clearing verb.
		 */
		focusBlockComponent: (path: number[], offset: number): boolean => {
			const block = editor.__test.getBlockComponent(path);
			if (!block) return false;
			block.focus(offset);
			return true;
		},
		parkCaretInBlockComponent: (path: number[], offset: number): boolean => {
			const block = editor.__test.getBlockComponent(path);
			if (!block?.parkCaret) return false;
			block.parkCaret(offset);
			return true;
		},
		/**
		 * The shallow/deep cursor contract `getSelection()` hides: a 2D surface like
		 * TableBlock nulls its shallow getCursorOffset because (row, col) can't be
		 * losslessly packed into one integer.
		 */
		getBlockCursorSurface: (
			path: number[]
		): {
			exists: boolean;
			cursorOffset: number | null;
			cursorPosition: { path: number[]; offset: number } | null;
		} => {
			const block = editor.__test.getBlockComponent(path);
			if (!block) return { exists: false, cursorOffset: null, cursorPosition: null };
			const cursorOffset = block.getCursorOffset();
			const cursorPosition = block.getCursorPosition?.() ?? null;
			return { exists: true, cursorOffset, cursorPosition };
		},
		// ── BlockListState consistency probe ─────────────────────────────
		/**
		 * Walks the LIVE CST, not a re-parse, for containers whose registered
		 * BlockListState has drifted in length from node.children. Throws rather than
		 * reporting `[]` when containers exist but none resolved a state: call sites
		 * assert `toEqual([])`, so a registration regression would turn every one of them
		 * vacuously green. Same loud-on-absent shape as `e2e/container-parity.ts`.
		 */
		auditBlockListStateConsistency: (): Array<{
			path: number[];
			kind: string;
			childrenLen: number;
			idsLen: number;
			refsLen: number;
		}> => {
			const doc = editor.__test.getDocument();
			const violations: Array<{
				path: number[];
				kind: string;
				childrenLen: number;
				idsLen: number;
				refsLen: number;
			}> = [];
			let containers = 0;
			let resolved = 0;
			function walk(node: CstNode, path: number[]): void {
				if (!node.children) return;
				containers++;
				const state = getStateForNode(node);
				if (state) {
					resolved++;
					const childrenLen = node.children.length;
					const idsLen = state.innerBlockIds.length;
					const refsLen = state.innerBlockRefs.length;
					if (idsLen !== childrenLen || refsLen !== childrenLen) {
						violations.push({ path: [...path], kind: node.kind, childrenLen, idsLen, refsLen });
					}
				}
				for (let i = 0; i < node.children.length; i++) {
					walk(node.children[i], [...path, i]);
				}
			}
			for (let i = 0; i < doc.children.length; i++) {
				walk(doc.children[i], [i]);
			}
			if (containers > 0 && resolved === 0) {
				throw new Error(
					`auditBlockListStateConsistency: ${containers} container(s) in the live tree resolved no BlockListState; the audit visited nothing and must not report vacuous success`
				);
			}
			return violations;
		}
	};
}
