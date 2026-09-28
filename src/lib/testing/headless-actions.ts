/**
 * The one headless `EditorActionsDeps` builder, behind the published conformance kits and the
 * in-repo test harness alike. Nothing here may import a test runner, since an author's own suite
 * imports this subpath; a runner's mock enters through the `spy` option.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';
import type { CaretMemory } from '../cursor/caret-memory';
import type { EditorActionsDeps } from '../editor-actions/deps';
import { withStoredCaret } from '../editor-actions/stored-caret';
import { kitReading } from './kit-reading';
import type { Reading } from '../schema/reading';
import { createEditorEvents, type EditorEvents } from '../editor-events';
import { refSlotsOver, replaceRefs } from '../reactivity/publish-ref.svelte';
import { descendTo, type ChildList } from '../reactivity/child-list';
import { createSelectionState } from '../selection/selection-state.svelte';
import { createCaretLanding, type CaretLanding } from '../selection/caret-landing';
import { caretTargetFor, type CaretTarget } from '../selection/caret-target';
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

export function stubCaretMemory(): CaretMemory {
	return {
		column: () => null,
		side: () => null,
		pendingMarks: { get: () => null, toggle: () => {}, consume: () => null, restore: () => {} },
		noteKey: () => {},
		noteTyping: () => {},
		noteExtreme: () => {},
		captureColumn: () => {},
		forget: () => {}
	};
}

/** A block list that writes nothing: every edit resolves false, and a content write is admitted
 *  with its caret where the caller asked. */
export function stubBlockEdit(): BlockEditActions {
	const wroteNothing = async () => false;
	return {
		splitBlock: wroteNothing,
		descendToBody: wroteNothing,
		insertParagraph: wroteNothing,
		mergeWithPrevious: wroteNothing,
		mergeWithNext: wroteNothing,
		deleteBlock: wroteNothing,
		updateBlockContent: (_index, _text, _mode, preEditOffset, postEditFocusOffset) =>
			withStoredCaret(Promise.resolve(false), postEditFocusOffset ?? preEditOffset ?? 0),
		updateBlockMetadata: wroteNothing,
		replaceBlock: wroteNothing
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
		// Headless: nothing is rendered, so there is no boundary to put a gap caret at.
		tryGapStop: () => false
	};
}

// ── Editor-actions environment ───────────────────────────────────────────────

export interface HeadlessActionsOptions {
	/** Wraps each stubbed collaborator (the caret memory, every block ref), so a runner's mock
	 *  can record the calls. */
	spy?: <T extends object>(stub: T) => T;
	/** A construction option because `SelectionState` cannot take one later. */
	onSelectionChange?: () => void;
	/** The editor's reading, for a suite whose editor is in another mode or switched a syntax off.
	 *  Absent, every installed plugin in styled source. */
	reading?: Reading;
	bumpContentVersion?: () => void;
}

export interface HeadlessActions {
	deps: EditorActionsDeps;
	doc: Document;
	events: EditorEvents;
	/** Every leaf a caret landing resolved to, in order, whether or not a block was there to take it. */
	landings: readonly CaretTarget[];
	getBlockIds(): string[];
	getBlockRefs(): (BlockComponent | undefined)[];
}

/** An `EditorActionsDeps` over `source`, every block treated as mounted. Pass the whole `Document`
 *  or source text, not its children, which lose the trailing blank line its `suffix` holds. */
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
	const landings: CaretTarget[] = [];
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
		caretMemory: spy(stubCaretMemory()),
		// Document-aware, as the editor's own is: without the document a deep table endpoint is
		// stored raw, and every dispatch sees endpoints the editor never makes.
		selectionState: createSelectionState({
			getDoc: () => doc,
			...(options.onSelectionChange ? { onChange: options.onSelectionChange } : {})
		}),
		getBlockElByPath: () => null,
		revealPath: (path: number[]) => descendTo(rootList, path),
		get caretLanding() {
			return caretLanding;
		},
		events,
		// An author's suite runs with no editor, so every installed plugin is in the grammar.
		reading: options.reading ?? kitReading()
	};
	// No render window: nothing mounts later, so an empty entry counts as out of range.
	const rootList: ChildList = {
		count: () => doc.children.length,
		refs: deps.blockRefSlots,
		windowing: { revealChild: async () => {}, isInWindow: (i) => blockRefs[i] !== undefined }
	};
	const caretLanding = recordingLanding(
		createCaretLanding({
			getDoc: () => doc,
			root: rootList,
			selectionState: deps.selectionState,
			// Read live: a suite may swap in its own caret memory after building the deps.
			caretMemory: {
				forget: () => deps.caretMemory.forget(),
				noteExtreme: () => deps.caretMemory.noteExtreme()
			},
			getBlockElByPath: deps.getBlockElByPath,
			scroll: null
		}),
		() => doc,
		landings
	);
	return {
		deps,
		doc,
		events,
		landings,
		getBlockIds: () => blockIds,
		getBlockRefs: () => blockRefs
	};
}

/** `landing` with each resolved leaf pushed onto `landings` before it lands. */
function recordingLanding(
	landing: CaretLanding,
	getDoc: () => Document,
	landings: CaretTarget[]
): CaretLanding {
	return {
		...landing,
		land(pos, opts) {
			const target = caretTargetFor(getDoc(), pos, { openCollapsed: opts?.openCollapsed });
			if (target) landings.push(target);
			return landing.land(pos, opts);
		}
	};
}

function documentOf(source: string | Document | CstNode[]): Document {
	if (typeof source === 'string') return parse(source);
	if (Array.isArray(source)) return { kind: 'document', prefix: '', children: source, suffix: '' };
	return source;
}
