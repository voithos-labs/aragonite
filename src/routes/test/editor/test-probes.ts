import { tick } from 'svelte';
import type { Editor, PastedImage, PresentationMode } from '$lib';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseConverges } from '$lib/testing/parse-convergence';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { spliceChildren } from '$lib/tree-operations/children';
import { getStateForNode } from '$lib/reactivity/state-registry';
import type { BlockKind, CstNode, Document } from '$lib/core/nodes';
import type { GapCaretPosition } from '$lib/selection/gap-caret';
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
	isPasteTransformRegistered,
	registerPasteTransform
} from '$lib/tree-operations/paste/paste-transforms';
import {
	dumpTree,
	dumpUndoStack,
	dumpOperationsLog,
	dumpInteractionTrace
} from '$lib/debug/inspect';
import {
	dumpFocusedInlineTree,
	isCrossBlockSnapshot,
	liveSelectionText
} from '../../debug-panel/panel-sections';
import { enablePerfInstruments, resetPerfInstruments, perfSnapshot } from '$lib/perf/instruments';
import {
	enableInteractionTrace,
	disableInteractionTrace,
	interactionTraceKeydownCount,
	interactionTraceSnapshot
} from '$lib/debug/interaction-trace';
import type { ClosureBlock } from '$lib/schema/closure';
import ThrowOnRenderBlock from './ThrowOnRenderBlock.svelte';

type EditorInstance = ReturnType<typeof Editor>;

// These kinds only reach BlockHost's fallback paths, never a real editable block, so every
// cross-cutting system is honestly not-supported.
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

// ── Conformance sweep entries (backs the browser sweep e2e) ────────────────

// The three closure columns the headless suite records as `boundary`: they work only against
// mounted DOM, so the browser sweep runs them per kind.
interface ConformanceSweepEntry {
	kind: string;
	fixture: string;
	// Taken from the fixture's first text leaf and absent from the paragraphs the sweep puts
	// either side of it, so a match can only have come from this block. Null when the block
	// has no searchable text.
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

// The leaf's raw text, not the node's own: a container's opener (`:::note`, `> `) is syntax
// the search never scans, so a token taken from it would never paint.
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

// One row per kind that declares a conformanceFixture, parsed against this route's registry: if
// another plugin's opener takes the fixture first, the token comes back null, so the sweep
// records that gap instead of these probes hiding it.
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
	// A sweep over zero rows checks nothing about any kind, so this fails loudly instead.
	if (entries.length === 0) {
		throw new Error(
			'collectConformanceEntries: no registered kind declares a conformanceFixture; the browser sweep would run over an empty set'
		);
	}
	return entries;
}

// ── The `window.__test` probes the e2e suite drives ────────────────────────

type ProbeRect = { top: number; left: number; width: number; height: number } | null;
type CaretProbeState = { captured: boolean; rect: ProbeRect };

// A session subscribes to one editor's events. The array it fills lives at module level and
// survives a remount; the subscription does not, so a read afterwards would hand back an empty
// array that proves nothing. `invalidate` marks the session dead and the read throws.
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
const menuProbe = createSessionProbe<boolean[]>(() => []);
const caretProbe = createSessionProbe<CaretProbeState>(() => ({ captured: false, rect: null }));
const selectionProbe = createSessionProbe<SelectionChangeRecord[]>(() => []);

/** A container whose registered BlockListState has drifted from its children. */
interface StateDrift {
	path: number[];
	kind: string;
	childrenLen: number;
	idsLen: number;
	refsLen: number;
}

/**
 * One `selectionChange` payload, flattened so it survives `page.evaluate`. `raw` is the focus
 * block's source bytes as they stood when the event fired, which is how a spec tells an
 * announcement made before the bytes typed there from one made after them.
 */
interface SelectionChangeRecord {
	anchor: { path: number[]; offset: number } | null;
	focus: { path: number[]; offset: number } | null;
	raw: string | null;
}

// ── The host's image-paste hook ────────────────────────────────────────────
//
// `onPasteImage` is fixed at mount, so the page installs this one stable function (opted in
// with `?imagePaste=on`) and a spec swaps what it answers behind it, rather than remounting for
// each case. Responses are used one per image; the last one repeats.

interface ImagePasteResponse {
	/** Markdown to insert; omitted or null exercises the case where the image is skipped. */
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
// Handles kept by source name so a spec can dispose or invalidate a source it registered:
// the handle holds functions and cannot cross page.evaluate.
const decorationHandles = new Map<string, DecorationSourceHandle>();

// Installs the e2e probes on `window.__test`. What they do must stay exactly as it is:
// the e2e suite drives the editor through them.
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
	menuProbe.invalidate(remounted);
	caretProbe.invalidate(remounted);
	selectionProbe.invalidate(remounted);

	// Nothing is filtered out: the requirement files claim "exactly one edit event per user
	// gesture" with no exceptions, so a filter would let a second commit go uncounted.
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
		// Changes the prop without moving DOM focus, the one path that exercises how the editor
		// reconciles data-focused on a mode change (the header toggles blur instead).
		setPresentationMode: (mode: PresentationMode) => {
			setPresentationMode(mode);
		},
		// getBlockCount, getBlockKind and dumpTree read the live CST, not parse(getSource()): a
		// reparse cannot see a block whose kind has left its raw text behind, or a short-lived
		// block the serializer trims.
		getBlockCount: () => editor.__test.getDocument().children.length,
		// Rebuilds the windowing of a nested container's child list without moving the scroll,
		// unlike setSource or undo; a root path is rejected because the root's ids live in a
		// separate array. The ancestors' raw text is left out of date, so check through
		// getDocument() or parseConverged().
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
			spliceChildren(container, at, removeCount, inserted);
			container.children = [...(container.children ?? [])];
		},
		getBlockKind: (index: number) => editor.__test.getDocument().children[index]?.kind ?? '',
		getConformanceEntries: (): ConformanceSweepEntry[] => collectConformanceEntries(),
		// A descriptor with no registered component reaches BlockHost's no-component branch and
		// its visible-raw fallback. Kept outside ALL_BLOCK_KINDS, so the startup completeness
		// check is unaffected.
		makeBlockOrphan: (index: number): void => {
			const kind = 'orphanTest' as BlockKind;
			if (!tryGetBlockKindDescriptor(kind)) {
				registerBlockKind(kind, {
					gapEdges: 'none',
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
					gapEdges: 'none',
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
		// Reads SelectionState, never the `data-cross-block` attribute that follows it a tick
		// later: the lag turns every `false` check into a pass, and the attribute is
		// document-wide, so on a two-editor route it answers for the wrong one. `editor-rects.ts`
		// follows the same rule.
		isCrossBlockActive: (): boolean => editor.__test.isCrossBlockActive(),
		// The third selection mode, read from the state for the same reason as above.
		getGapCaret: (): GapCaretPosition | null => editor.__test.getGapCaret(),
		// Narrower than the check above: a rectangle inside one table turns that on while both
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
		// Exact copies, unlike getSelectionPaths above: a round-trip spec has to hand back the
		// same endpoint variant it got, and the path-only form drops `cellCoordinate`.
		getSelection: (): EditorSelection | null => editor.getSelection(),
		setSelection: (selection: EditorSelection): Promise<boolean> => editor.setSelection(selection),
		// The real call on the instance, made the way an app answering a click on its own UI
		// makes it: viewport coordinates the app read off its own element.
		placeCaretAtPoint: (x: number, y: number): boolean => editor.placeCaretAtPoint(x, y),
		// The insertion call, made the way a consumer's toolbar makes it.
		insertMarkdown: (md: string): boolean => editor.insertMarkdown(md),
		// The command call, made the way a selection toolbar's button makes it: an id alone,
		// no key combination, no keydown.
		runCommand: (commandId: string): boolean => editor.runCommand(commandId),
		// A plugin-shaped paste transform without a plugin. Transforms are register-once and
		// process-global, so the probe asks before registering rather than catching the throw.
		registerPasteTransform: (name: string, find: string, replace: string): void => {
			if (isPasteTransformRegistered(name)) return;
			registerPasteTransform({
				name,
				transform: (text) => (text.includes(find) ? text.split(find).join(replace) : null)
			});
		},
		roundTripStable: (): boolean => {
			const src = editor.getSource();
			return serialize(parse(src)) === src;
		},
		// The check that the live tree still parses to itself. roundTripStable above holds for
		// all valid GFM whatever the tree looks like; this compares the live CST against a
		// reparse of its own serialization, so it catches a tree that has drifted from its raw.
		parseConverged: (): boolean => parseConverges(editor.__test.getDocument()),
		// The bar shows a match count instead of "N replaced" whenever matches survive a
		// replace (skipped container matches), so specs read the replaced count here.
		getSearchReplacedCount: (): number | null => editor.getSearch().replacedCount,
		// ── Image-paste controls (the hook itself is installed by the page) ──
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
		// Reads caretRect inside the synchronous handler, before the deferred data-cross-block
		// $effect runs, which pins caretRect to SelectionState: the out-of-date attribute would
		// report the cross-block range the caret was left in.
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
		// Every payload in order, so a spec can check what a subscriber sees mid-gesture: the
		// whole run of events, not only the last one.
		startSelectionChangeCapture: (): void =>
			selectionProbe.start((records) =>
				editor.getEvents().on('selectionChange', (sel) => {
					const node = sel
						? (nodeAt(editor.__test.getDocument(), sel.focus.path) as CstNode | null)
						: null;
					records.push({
						anchor: sel && { path: sel.anchor.path, offset: sel.anchor.offset },
						focus: sel && { path: sel.focus.path, offset: sel.focus.offset },
						raw: node && 'raw' in node ? node.raw : null
					});
				})
			),
		stopSelectionChangeCapture: (): SelectionChangeRecord[] => selectionProbe.stop(),
		// ── The performance instruments ───────────────────────────────────
		perf: {
			enable: enablePerfInstruments,
			reset: resetPerfInstruments,
			snapshot: perfSnapshot
		},
		// ── The interaction trace ─────────────────────────────────────────
		trace: {
			enable: enableInteractionTrace,
			disable: disableInteractionTrace,
			snapshot: interactionTraceSnapshot,
			keydownCount: interactionTraceKeydownCount
		},
		// The harness's one way to wait out a gesture that records no keydown result.
		drainTick: (): Promise<void> => tick(),
		// ── The consumer's diagnostics call (real, not the extracted builder) ──
		// Through the real call, so the `includeSource ?? false` default is exercised where
		// it lives.
		serializeDiagnostics: (opts?: { includeSource?: boolean }) =>
			editor.getDiagnostics().serializeDiagnostics(opts),
		// ── The debug dumps ───────────────────────────────────────────────
		dumpTree: (opts?: Parameters<typeof dumpTree>[1]) =>
			dumpTree(editor.__test.getDocument(), opts),
		dumpSelection: () => liveSelectionText(editor),
		dumpInlineTree: () => dumpFocusedInlineTree(editor.getSource()),
		dumpUndoStack: (n = 10) => dumpUndoStack(editor.__test.getUndoStack(), n),
		dumpOperationsLog: (n = 20) => dumpOperationsLog(editor.__test.getOperationsLog(), n),
		dumpInteractionTrace: (n = 50) => dumpInteractionTrace(interactionTraceSnapshot(), n),
		// ── Edit-event capture probe ──────────────────────────────────────
		// One array; a second start replaces the first. A caller wanting a count takes the
		// array's length.
		startEditOpCapture: (): void => editOpProbe.start(subscribeEditOps),
		stopEditOpCapture: (): string[] => editOpProbe.stop(),
		// ── Error-event capture probe ─────────────────────────────────────
		// Subscribes to the same EditorEvents instance BlockHost emits to, so a caught render
		// failure shows up here.
		startErrorCapture: (): void =>
			errorProbe.start((origins) =>
				editor.getEvents().on('error', (e) => {
					origins.push(e.origin);
				})
			),
		getCapturedErrors: (): string[] => errorProbe.peek(),
		// ── Menu-change capture probe ─────────────────────────────────────
		startMenuChangeCapture: (): void =>
			menuProbe.start((changes) =>
				editor.getEvents().on('menuChange', (open) => {
					changes.push(open);
				})
			),
		stopMenuChangeCapture: (): boolean[] => menuProbe.stop(),
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
		 * Makes the stale detached reference the windowed block loop's cleanup only rarely
		 * leaves behind: capture the mounted component here, then write it back into a cleared
		 * position with `replantBlockRef`.
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
		// ── The BlockComponent caret calls ───────────────────────────────
		/**
		 * The public `BlockComponent` caret calls a plugin-authored container makes directly, and
		 * no gesture-level spec can reach (every built-in caret placement goes through a pointer
		 * or keyboard path first). `parkCaret` is optional in the contract, so its probe reports
		 * false rather than falling back to another call.
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
		 * The two cursor readings `getSelection()` hides: a two-dimensional block like TableBlock
		 * returns null from the flat getCursorOffset, because (row, column) cannot be packed into
		 * one integer without losing something.
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
		 * Walks the live CST for containers whose registered BlockListState has drifted in length
		 * from node.children. Throws rather than reporting `[]` when containers exist but none
		 * resolved a state: call sites check `toEqual([])`, which a broken registration would
		 * otherwise turn green for the wrong reason.
		 */
		auditBlockListStateConsistency: (): StateDrift[] => {
			const doc = editor.__test.getDocument();
			const violations: StateDrift[] = [];
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
