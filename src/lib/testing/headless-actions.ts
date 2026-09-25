/**
 * The one headless `EditorActionsDeps` builder, behind the published conformance kits and the
 * in-repo test harness alike. Nothing here may import a test runner, since an author's own suite
 * imports this subpath; a runner's mock enters through the `spy` option.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { EditorActionsDeps } from '../editor-actions/deps';
import type { PresentationMode } from '../presentation-mode';
import { defaultGrammarView } from '../schema/block-openers';
import { createEditorEvents, type EditorEvents } from '../editor-events';
import { refSlotsOver, replaceRefs } from '../reactivity/publish-ref.svelte';
import { createSelectionState } from '../selection/selection-state.svelte';
import { createSharingState } from '../tree-operations/sharing';
import { createUndoManager } from '../undo/manager';

// ── Stubs ────────────────────────────────────────────────────────────────────

export function stubBlockComponent(overrides: Partial<BlockComponent> = {}): BlockComponent {
	return {
		focus: () => {},
		parkCaret: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true,
		...overrides
	} as BlockComponent;
}

export function stubStickyColumn(): StickyColumnState {
	return { get: () => null, reset: () => {}, capture: () => {}, noteKey: () => {} };
}

export function stubEdgeAffinity(): EdgeAffinityState {
	return {
		get: () => null,
		reset: () => {},
		note: () => {},
		noteTyping: () => {},
		noteExtreme: () => {}
	};
}

export function stubBlockEdit(): BlockEditActions {
	return {
		splitBlock: () => {},
		descendToBody: () => {},
		insertParagraph: () => {},
		mergeWithPrevious: () => {},
		mergeWithNext: () => {},
		deleteBlock: () => {},
		updateBlockContent: () => {},
		updateBlockMetadata: () => {},
		replaceBlock: () => {}
	};
}

/** A focus bundle that records what bubbled up to it, which is what the focus-bubble check reads. */
export interface RecordingFocus extends FocusActions {
	/** Whole argument lists, so a check pins arity as well as values. */
	readonly moveFocusCalls: readonly unknown[][];
}

export function recordingFocus(): RecordingFocus {
	const moveFocusCalls: unknown[][] = [];
	return {
		moveFocusCalls,
		moveFocus: (...args: unknown[]) => {
			moveFocusCalls.push(args);
		},
		// The focus-bubble consumers assert on moveFocus, never on a resolved component.
		revealPath: async () => null,
		// Headless: nothing is rendered, so there is no boundary to put a gap caret at.
		tryGapStop: () => false
	};
}

// ── Editor-actions environment ───────────────────────────────────────────────

export interface HeadlessActionsOptions {
	/** Wraps each stubbed collaborator (the sticky column, the edge affinity, every block ref), so
	 *  a runner's mock can record the calls. */
	spy?: <T extends object>(stub: T) => T;
	/** A construction option because `SelectionState` cannot take one later. */
	onSelectionChange?: () => void;
	presentationMode?: PresentationMode;
	bumpContentVersion?: () => void;
}

export interface HeadlessActions {
	deps: EditorActionsDeps;
	doc: Document;
	events: EditorEvents;
	getBlockIds(): string[];
	getBlockRefs(): (BlockComponent | undefined)[];
}

/**
 * An `EditorActionsDeps` over `source`, with every block treated as mounted. Pass a whole parsed
 * `Document` (or the source text) rather than its children: its `suffix` holds the trailing blank
 * line a children-only fixture loses.
 */
export function createHeadlessActions(
	source: string | Document | CstNode[],
	options: HeadlessActionsOptions = {}
): HeadlessActions {
	const whole = documentOf(source);
	const doc: Document = {
		kind: 'document',
		prefix: whole.prefix,
		children: whole.children,
		suffix: whole.suffix
	};
	const spy = options.spy ?? (<T>(stub: T) => stub);
	let blockIds = doc.children.map((_, i) => `block-${i}`);
	const blockRefs: (BlockComponent | undefined)[] = doc.children.map(() =>
		spy(stubBlockComponent())
	);
	const events = createEditorEvents();
	const deps: EditorActionsDeps = {
		get doc() {
			return doc;
		},
		get blockIds() {
			return blockIds;
		},
		get blockRefs() {
			return blockRefs;
		},
		blockRefSlots: refSlotsOver(blockRefs),
		// In place, so `doc` stays the one live document the caller holds.
		setDoc: (next: Document) => {
			Object.assign(doc, next);
		},
		setBlockIds: (next: string[]) => {
			blockIds = next;
		},
		setBlockRefs: (next: (BlockComponent | undefined)[]) => {
			replaceRefs(blockRefs, next);
		},
		bumpContentVersion: options.bumpContentVersion ?? (() => {}),
		undoManager: createUndoManager(),
		sharing: createSharingState(),
		stickyColumn: spy(stubStickyColumn()),
		edgeAffinity: spy(stubEdgeAffinity()),
		// Document-aware, as the editor's own is: without the document a deep table endpoint is
		// stored raw, and every dispatch sees endpoints the editor never makes.
		selectionState: createSelectionState({
			getDoc: () => doc,
			...(options.onSelectionChange ? { onChange: options.onSelectionChange } : {})
		}),
		getBlockElByPath: () => null,
		// No render window: every block counts as mounted, so a reveal takes the editor's
		// already-mounted route, reading the live refs and descending if nested.
		revealPath: async (path: number[]) => {
			if (path.length === 0) return null;
			const ref = blockRefs[path[0]];
			if (!ref) return null;
			if (path.length === 1) return ref;
			return ref.getBlockComponentByPath?.(path.slice(1)) ?? null;
		},
		events,
		// An author's suite runs with no editor, so every installed plugin is in the grammar.
		grammar: defaultGrammarView,
		linkRef: { grammar: defaultGrammarView },
		getPresentationMode: options.presentationMode ? () => options.presentationMode! : undefined
	};
	return { deps, doc, events, getBlockIds: () => blockIds, getBlockRefs: () => blockRefs };
}

function documentOf(source: string | Document | CstNode[]): Document {
	if (typeof source === 'string') return parse(source);
	if (Array.isArray(source)) return { kind: 'document', prefix: '', children: source, suffix: '' };
	return source;
}
