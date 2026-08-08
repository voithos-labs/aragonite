/**
 * The editable-leaf seam a plugin block component builds on: a text-editing block
 * surface with native caret/IME/undo/cross-block-selection parity, in one factory so a
 * plugin never touches an editor context key. Two modes — `plain` (always mounted,
 * commits per keystroke) and `render-primary` (reveals its source, commits once on
 * blur). Call synchronously during init. Contract: plugin-guide § The editable leaf.
 */

import { getContext, tick } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';
import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
import type { StickyColumnDirection } from '../../block-component';
import type { NodeView } from '../../core/node-views';
import {
	BLOCK_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices,
	type PluginEditorLookup
} from '../../editor-keys';
import { emitCommandError } from '../../editor-events';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import {
	setCursorOffset,
	getCursorOffset,
	getSelectionOffsets
} from '../../cursor/content-offsets';
import { handleSharedKeydown } from '../../selection/shared-keydown';
import {
	createEditableSurface,
	createClipboardHandlers,
	consumePendingRestore
} from './editable-surface';
import { createContentOffsetBackend, anchorTrailingNewline } from './plain-text-backend';
import { parkFocusOnEditorRoot } from '../../selection/native-bridge';
import { resetForPointerDown } from '../../selection/cross-block/pointer';
import { placeCaret } from '../../selection/caret-doors';
import { createSourceReveal } from '../../cursor/reveal-source';
import { traceRevealOpen, traceRevealFold } from '../../debug/interaction-trace';
import { trimTrailingLineEnding, trailingLineEnding } from '../../core/lines';
import type { PresentationMode } from '../../presentation-mode';
import { eventToChord } from '../../schema/keybindings';
import { type CommandId } from '../../schema/commands';
import {
	dispatchKeyCommand,
	type BlockCommandContext,
	type CommandErrorSink
} from '../../schema/block-commands';
import { pluginKindOwner } from '../../schema/plugin-install';

export type EditableLeafMode = 'plain' | 'render-primary';

/**
 * The frozen inputs the host component feeds in. A function-valued field is a **live
 * read**, re-evaluated on every use, so a structural op or undo replacement is observed
 * rather than snapshotted; `mode` is static configuration captured at the factory call.
 */
export interface EditableLeafDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	/** The source contenteditable; null while unmounted (render-primary's rendered view). */
	getEl(): HTMLElement | null;
	mode?: EditableLeafMode;
	/** render-primary only: the component owns the swap flag and both views. */
	isRevealed?(): boolean;
	setRevealed?(revealed: boolean): void;
	/**
	 * The mounted component's view-state hooks, handed to a minted block command as
	 * `ctx.hooks`. Read live at dispatch: return a getter, never a captured value. The
	 * platform treats it as `unknown`; the plugin casts it.
	 */
	commandHooks?: () => unknown;
}

/**
 * The one-spread source surface: `<div {...leaf.surfaceProps}>` wires every handler and
 * attribute a source contenteditable needs, so a consumer cannot drop one (a forgotten
 * `oncompositionend` breaks IME silently). Symbol-keyed Svelte attachments carry the
 * view-lifecycle contracts: the source populated as a SINGLE text node (so the ambient
 * offset walk stays exact), and the focus-park on unmount.
 */
export interface EditableLeafSurfaceProps {
	tabindex: number;
	/** Reading mode makes a plain leaf's always-mounted source inert. */
	contenteditable: 'true' | 'false';
	role: 'textbox';
	spellcheck: 'false';
	oninput: () => void;
	onkeydown: (e: KeyboardEvent) => void | Promise<void>;
	oncopy: (e: ClipboardEvent) => void;
	oncut: (e: ClipboardEvent) => Promise<void>;
	onpaste: (e: ClipboardEvent) => Promise<void>;
	onpointerdown: (e: PointerEvent) => void;
	onfocusout: () => void;
	oncompositionstart: () => void;
	oncompositionend: () => void;
	/** View-sync + focus-park ride Svelte attachments under symbol keys. */
	[attachment: symbol]: unknown;
}

export interface EditableLeaf {
	/** The block's source minus its trailing line ending — the editable text. */
	readonly sourceText: string;

	/** The one-spread source surface (attributes + handlers + view/park attachments). */
	surfaceProps: EditableLeafSurfaceProps;

	/**
	 * The live EFFECTIVE presentation mode. The factory already gates itself in
	 * 'reading' (no reveal, no commits); a plain-mode component additionally binds
	 * `contenteditable` off this so its always-mounted source goes structurally inert.
	 */
	getPresentationMode(): PresentationMode;

	/**
	 * The live editor theme name (`data-editor-theme`), for a leaf whose rendered half
	 * comes from an engine emitting its own colors rather than from CSS.
	 */
	getTheme(): string;

	// ── BlockComponent surface (mode-guarded; re-export as one-liners) ────────
	focus(offset: number): void;
	parkCaret(offset: number): void;
	focusAtColumn(x: number, from: StickyColumnDirection): void;
	getCursorOffset(): number | null;
	getSelectedText(): string;
	setSelection(start: number, end: number): void;
	measurePartialRects(startOffset: number, endOffset: number): DOMRect[];
	runCommand(id: CommandId): boolean;

	// ── Source-element event handlers ─────────────────────────────────────────
	onInput(): void;
	onCompositionStart(): void;
	onCompositionEnd(): void;
	/**
	 * Clipboard interception with sibling-surface parity (editor.md § Clipboard). Bind on
	 * the source element only — a render-primary folded view has no source to slice, so
	 * it falls to native copy.
	 */
	onCopy(e: ClipboardEvent): void;
	onCut(e: ClipboardEvent): Promise<void>;
	onPaste(e: ClipboardEvent): Promise<void>;
	handleKeydown(e: KeyboardEvent): Promise<void>;
	onPointerDown(e: PointerEvent): void;
	/** render-primary: commit-on-blur (fold + one CST commit). Plain: no-op. */
	onFocusOut(): void;
	/** render-primary: reveal-on-click for the rendered view (shift-click extends a selection instead). */
	onRenderPointerDown(e: PointerEvent): void;

	// ── Programmatic edits ─────────────────────────────────────────────────────
	/** Mount/focus the source with the caret at `offset` (plain mode: focus only). */
	reveal(offset?: number): Promise<void>;
	/** Commit edited source as one undo entry; the parse decides update / kind change / structural split. */
	commitSource(edited: string): void;

	// ── View hooks ─────────────────────────────────────────────────────────────
	/**
	 * Sync `sourceText` into the source element as a single text node, restoring the caret
	 * when the text changed under a live one. Call from a `$effect` — reading `sourceText`
	 * inside tracks the node's raw.
	 */
	syncSource(): void;
	/** Effect-cleanup hook: park focus on the editor root when the source unmounts while focused. */
	parkFocus(el: HTMLElement | null): void;
}

/**
 * The node → metadata bridge (plus `commandHooks`) a minted block command resolves
 * against on the leaf tier — the container factory's `buildContainerKindTarget` sibling.
 * Every field reads through `deps`' thunks at dispatch, so a node swap or hook rebind is
 * observed live; `pluginEditor` resolves by the kind's recorded owner.
 */
export function buildLeafCommandContext(
	deps: Pick<EditableLeafDeps, 'getNode' | 'getIndex' | 'commandHooks'>,
	blockEdit: Pick<BlockEditActions, 'updateBlockMetadata'>,
	pluginEditor?: PluginEditorLookup
): Omit<BlockCommandContext, 'arg'> {
	return {
		node: deps.getNode(),
		updateMetadata: (patch) => void blockEdit.updateBlockMetadata(deps.getIndex(), patch),
		hooks: deps.commandHooks?.(),
		editor: pluginEditor?.(pluginKindOwner(deps.getNode().kind) ?? '')
	};
}

export function createEditableLeaf(deps: EditableLeafDeps): EditableLeaf {
	const mode: EditableLeafMode = deps.mode ?? 'plain';
	if (mode === 'render-primary' && (!deps.isRevealed || !deps.setRevealed)) {
		throw new Error('createEditableLeaf: render-primary mode requires isRevealed + setRevealed');
	}
	// Plain mode's source is always the editable view.
	const isRevealed = mode === 'render-primary' ? deps.isRevealed! : () => true;

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		edgeAffinity,
		reorder,
		selection,
		registryView,
		events: editorEvents
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		keybindingOverrides,
		presentationMode: getPresentationModeCtx,
		theme: getThemeCtx,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const getPresentationMode = (): PresentationMode => getPresentationModeCtx?.() ?? 'source';
	const getTheme = (): string => getThemeCtx?.() ?? 'dark';
	const isReading = () => getPresentationMode() === 'reading';
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

	let composing = false;
	let preEditOffset = 0;
	let pendingCursor: number | null = null;

	const sourceText = (): string => trimTrailingLineEnding(deps.getNode().raw);

	const { backend, getFocusOffset, getTextLen, readText } = createContentOffsetBackend(() =>
		deps.getEl()
	);

	const editableSurface = createEditableSurface({
		getEl: () => deps.getEl(),
		getAmbientLength: () => 0,
		// render-primary edits are ephemeral (one commit on blur); plain commits per keystroke.
		isInputSuppressed: () => mode === 'render-primary',
		backend,
		getMyPath: deps.getPath,
		getIndex: deps.getIndex,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset) => {
			preEditOffset = offset;
		},
		// render-primary never restores a pending caret — focus has already left on
		// commit, and a re-render must not yank it back.
		setPendingCursor: (offset) => {
			if (mode === 'plain') pendingCursor = offset;
		},
		selection,
		getDoc,
		getBlockElByPath,
		focusActions,
		getEditorRoot,
		getScrollHost,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		grammar: registryView.grammar,
		events: editorEvents,
		getFocusOffset,
		getTextLen,
		// Raw-editable chrome: `supportsInline: false`, so no construct hides a run here.
		getInlines: () => [],
		readText,
		commitInput: (text, preEdit, saved) => {
			// !isReading: the leaf is the seam — even if a plain-mode component keeps
			// its source editable in reading mode, nothing reaches the CST.
			if (mode === 'plain' && !isReading()) {
				void blockEdit.updateBlockContent(
					deps.getIndex(),
					text + trailingLineEnding(deps.getNode().raw),
					preEdit,
					saved
				);
			}
		}
	});

	const surface = editableSurface.surface;
	const crossBlock = editableSurface.crossBlock;

	// The caret core; the swap is the component's reveal flag. Blocks commit on blur via
	// `commitReveal`, never the kernel's Escape-cancel `commit()`, so only `reveal()` is
	// driven here. Plain mode's swap thunks are inert.
	const revealKernel = createSourceReveal({
		get container() {
			return deps.getEl();
		},
		get sourceStart() {
			return 0;
		},
		get sourceEnd() {
			return sourceText().length;
		},
		get source() {
			return sourceText();
		},
		getAmbientLength: () => 0,
		isRevealed,
		// The one point block source is shown — the kernel calls it only when not
		// already revealed, so it fires once per open.
		showSource: () => {
			traceRevealOpen('leaf');
			deps.setRevealed?.(true);
		},
		showRendered: () => deps.setRevealed?.(false)
	});

	// ── Commit ─────────────────────────────────────────────────────────────────

	function commitSource(edited: string): void {
		// One undo entry: the anchor is where the caret entered the edit; the post-edit
		// caret follows the edit position.
		void blockEdit.updateBlockContent(
			deps.getIndex(),
			edited + trailingLineEnding(deps.getNode().raw),
			preEditOffset,
			edited.length
		);
	}

	function commitReveal(): void {
		if (mode !== 'render-primary' || !isRevealed()) return;
		// A cross-block selection sweeping through keeps the source revealed so its rects
		// measure real text, and focusout is this fold's only entry — so the leaf stays in
		// source view until the user focuses it and leaves again.
		if (selection.isCrossBlock) return;
		// Only wired to onFocusOut — the block leaf folds on blur, never Escape-cancel.
		traceRevealFold('blur');
		const edited = deps.getEl()?.textContent ?? sourceText();
		deps.setRevealed!(false); // reactive re-render of the edited source
		if (edited === sourceText()) return; // pure view toggle, nothing for the CST
		commitSource(edited);
	}

	// ── BlockComponent surface ─────────────────────────────────────────────────

	function parkCaret(offset: number): void {
		if (mode === 'render-primary') {
			// Reading mode: a rendered view has no source to reveal; focus is a no-op
			// and block-level traversal passes over.
			if (isReading()) return;
			void revealKernel.reveal(offset);
			return;
		}
		surface.parkCaret(offset);
	}

	const focus = placeCaret(selection, parkCaret);

	// Sticky-column entry: mount the source, then land at the column nearest x
	// on the first/last visual line — the code-block traversal contract.
	function focusAtColumn(x: number, from: StickyColumnDirection): void {
		void (async () => {
			if (!isRevealed()) {
				if (isReading()) return;
				deps.setRevealed!(true);
				await tick();
			}
			if (!deps.getEl()) return;
			surface.focusAtColumn(x, from);
		})();
	}

	function runCommand(id: CommandId): boolean {
		switch (id) {
			case 'block.moveUp':
				void reorder.nudgeReorderUnit(deps.getPath(), -1);
				return true;
			case 'block.moveDown':
				void reorder.nudgeReorderUnit(deps.getPath(), 1);
				return true;
			default:
				return false;
		}
	}

	const getCommandContext = () => buildLeafCommandContext(deps, blockEdit, pluginEditor);

	// ── View sync ──────────────────────────────────────────────────────────────

	function syncSource(): void {
		const text = sourceText();
		const el = deps.getEl();
		if (!el) return;
		const pending = pendingCursor;
		pendingCursor = null;
		if ((el.textContent ?? '') !== text) {
			el.textContent = text;
			anchorTrailingNewline(el);
			// Restore only under a live caret — an external rewrite (undo, structural
			// replace) must not steal focus.
			consumePendingRestore(el, pending, (offset) => setCursorOffset(el, asDomTextOffset(offset)));
		}
	}

	// ── Event handlers ─────────────────────────────────────────────────────────

	// Splice `insert` over the source text node's [start, end) and reseat the caret. A
	// DOM-text mutation keeps the offset walk exact where a native Enter/cut/paste would
	// inject <div>/<br> that vanish from textContent.
	function spliceSourceText(el: HTMLElement, start: number, end: number, insert: string): void {
		const text = el.textContent ?? '';
		el.textContent = text.slice(0, start) + insert + text.slice(end);
		anchorTrailingNewline(el);
		preEditOffset = start;
		setCursorOffset(el, asDomTextOffset(start + insert.length));
		if (mode === 'plain') editableSurface.onInput();
	}

	// ── Clipboard ────────────────────────────────────────────────────────────

	// The leaf's DOM-text space IS its raw, so copy falls to the seam's visible-selection
	// default and cut/paste splice verbatim. No structural paste hook: the commit
	// re-parses the whole raw, re-splitting only where the grammar demands. No reveal
	// fold — the render-primary source folds on blur instead.
	const clipboard = createClipboardHandlers({
		stickyColumn,
		edgeAffinity,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: isReading,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		cutTail: (e) => {
			const el = deps.getEl();
			if (!el) return;
			const sel = getSelectionOffsets(el);
			if (!sel || sel.start === sel.end) return;
			e.clipboardData?.setData('text/plain', (el.textContent ?? '').slice(sel.start, sel.end));
			spliceSourceText(el, sel.start, sel.end, '');
		},
		pasteTail: (e, pastedText) => {
			const el = deps.getEl();
			if (!el) return;
			const sel = getSelectionOffsets(el);
			const start = sel ? sel.start : (getCursorOffset(el) ?? (el.textContent ?? '').length);
			const end = sel ? sel.end : start;
			spliceSourceText(el, start, end, pastedText);
		}
	});

	async function handleKeydown(e: KeyboardEvent): Promise<void> {
		const el = deps.getEl();
		if (composing || !el) return;
		preEditOffset = getCursorOffset(el) ?? 0;

		if (await handleSharedKeydown(e, editableSurface.sharedCtx)) return;

		const chord = eventToChord(e);
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: deps.getNode().kind, runCommand, getCommandContext },
				{ history, pluginEditor, getPresentationMode },
				keybindingOverrides(),
				onCommandError
			)
		) {
			e.preventDefault();
			return;
		}

		// Enter stays inside the leaf as a literal newline (multiline source);
		// it never splits the block. Plain mode commits the insertion.
		if (e.key === 'Enter') {
			e.preventDefault();
			if (isReading()) return;
			const offset = getCursorOffset(el) ?? (el.textContent ?? '').length;
			spliceSourceText(el, offset, offset, '\n');
		}
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	function onRenderPointerDown(e: PointerEvent): void {
		// Shift-click extends a selection; a plain click reveals. Reading mode: no reveal
		// and no preventDefault, so native selection over the rendered view stays live.
		if (e.shiftKey || isReading()) return;
		e.preventDefault();
		// The reveal lands a caret, so this owes the shared preamble. NOT through
		// crossBlock.handlePointerDown: that hit-tests against the SOURCE text, which the
		// rendered view is not.
		resetForPointerDown(selection, stickyColumn, edgeAffinity, e.shiftKey);
		void revealKernel.reveal(0);
	}

	// ── Source surface bundle ────────────────────────────────────────────────────

	const surfaceHandlers = {
		tabindex: 0,
		role: 'textbox' as const,
		spellcheck: 'false' as const,
		oninput: editableSurface.onInput,
		onkeydown: handleKeydown,
		oncopy: clipboard.onCopy,
		oncut: clipboard.onCut,
		onpaste: clipboard.onPaste,
		onpointerdown: onPointerDown,
		onfocusout: commitReveal,
		oncompositionstart: editableSurface.onCompositionStart,
		oncompositionend: editableSurface.onCompositionEnd
	};

	// Both modes mirror external raw changes (undo, structural replace) into the source —
	// tracked, so it re-runs on raw change. A render-primary edit is ephemeral until blur, so
	// nothing else moves the raw mid-edit and the mirror cannot clobber an in-flight one. No
	// cleanup, so it never parks focus mid-edit.
	const syncAttachment = () => {
		syncSource();
	};
	// Park focus when the source unmounts. A separate, stable, untracked attachment, so a
	// recompute of the spread never fires the park mid-edit.
	const parkAttachment = (el: HTMLElement) => () => parkFocusOnEditorRoot(el, getEditorRoot());

	// The mode splits the rest of the view-lifecycle contract: render-primary's
	// `contenteditable` is constant, since reveal never fires in reading mode.
	const surfaceProps: EditableLeafSurfaceProps =
		mode === 'render-primary'
			? {
					...surfaceHandlers,
					contenteditable: 'true',
					[createAttachmentKey()]: syncAttachment,
					[createAttachmentKey()]: parkAttachment
				}
			: {
					...surfaceHandlers,
					get contenteditable() {
						return isReading() ? 'false' : 'true';
					},
					[createAttachmentKey()]: syncAttachment,
					[createAttachmentKey()]: parkAttachment
				};

	return {
		get sourceText() {
			return sourceText();
		},

		surfaceProps,

		getPresentationMode,
		getTheme,

		focus,
		parkCaret,
		focusAtColumn,
		getCursorOffset: () => (isRevealed() ? surface.getCursorOffset() : null),
		getSelectedText: () => (isRevealed() ? surface.getSelectedText() : ''),
		setSelection: (start, end) => {
			if (isRevealed()) surface.setSelection(start, end);
		},
		measurePartialRects: (startOffset, endOffset) => {
			if (isRevealed()) return surface.measurePartialRects(startOffset, endOffset);
			// Folded render-primary leaf: no source text node to measure, so mirror the
			// opaque single-unit container shim and cover the rendered block box for any
			// non-empty range (SELECTION_END exceeds every real start, so to-end paints too).
			if (endOffset <= startOffset) return [];
			const box = getBlockElByPath(deps.getPath());
			return box ? [box.getBoundingClientRect()] : [];
		},
		runCommand,

		onInput: editableSurface.onInput,
		onCompositionStart: editableSurface.onCompositionStart,
		onCompositionEnd: editableSurface.onCompositionEnd,
		onCopy: clipboard.onCopy,
		onCut: clipboard.onCut,
		onPaste: clipboard.onPaste,
		handleKeydown,
		onPointerDown,
		onFocusOut: commitReveal,
		onRenderPointerDown,

		reveal: (offset = 0) => {
			if (mode !== 'render-primary') return Promise.resolve(surface.focus(offset));
			return isReading() ? Promise.resolve() : revealKernel.reveal(offset);
		},
		commitSource,

		syncSource,
		parkFocus: (el) => parkFocusOnEditorRoot(el, getEditorRoot())
	};
}
