/**
 * The editable-leaf seam a plugin block component builds on: a text-editing
 * block surface with native caret/IME/undo/cross-block-selection parity.
 * Collapses the editable-surface plumbing, its context pulls, the shared-keydown
 * + chord dispatch, reorder commands, and the reveal/commit ceremony into one
 * factory — a plugin never touches an editor context key. The component supplies
 * only its view (markup, render/source effects) around the returned handlers.
 *
 * Two modes:
 *   'plain'          — the source contenteditable is always mounted; every
 *                      keystroke commits to the CST (prose-like undo batching).
 *                      The component calls `syncSource()` to mirror external
 *                      changes into its element with the caret restored.
 *   'render-primary' — a rendered view swaps to the source on reveal; edits
 *                      are ephemeral DOM until focus leaves, then commit as ONE
 *                      undo entry. The component owns the swap flag + visuals
 *                      (`isRevealed`/`setRevealed`) and both views' rendering.
 *
 * `commitSource` parses the edited text and lands it through the block-edit
 * ladder: same kind updates in place, a kind change remounts, multi-block text
 * structurally replaces the block with every parsed block (caret following the
 * edit position).
 *
 * Call synchronously during component init — the factory reads the editor's
 * ancestor contexts.
 */

import { getContext, tick } from 'svelte';
import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	HistoryActions
} from '../../action-contracts';
import type { StickyColumnDirection } from '../../block-component';
import type { NodeView } from '../../core/node-views';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
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
import { asDomTextOffset, asRawOffset } from '../../cursor/coordinate-spaces';
import {
	createRangeFromOffsets,
	setCursorOffset,
	getCursorOffset,
	getSelectionFocusOffset,
	getSelectionOffsets
} from '../../cursor/content-offsets';
import { handleSharedKeydown } from '../../selection/shared-keydown';
import { createEditableSurface } from './editable-surface';
import { parkFocusOnEditorRoot } from '../../selection/native-bridge';
import { writeCrossBlockCopy, writeCrossBlockCut } from '../../selection/cross-block/clipboard';
import { createSourceReveal } from '../../cursor/reveal-source';
import { traceRevealOpen, traceRevealFold } from '../../debug/interaction-trace';
import { trimTrailingLineEnding, trailingLineEnding, normalizeLineEndings } from '../../core/lines';
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
 * Reactive inputs the host component feeds in as getters, never values (see
 * `docs/contributing/culture.md`): each is re-read live so a structural op or
 * undo replacement is observed, never snapshotted.
 */
export interface EditableLeafDeps {
	get node(): NodeView;
	get index(): number;
	get path(): number[];
	/** The source contenteditable; null while unmounted (render-primary's rendered view). */
	getEl(): HTMLElement | null;
	mode?: EditableLeafMode;
	/** render-primary only: the component owns the swap flag and both views. */
	isRevealed?(): boolean;
	setRevealed?(revealed: boolean): void;
	/**
	 * The mounted component's view-state hooks, handed to a minted block command as
	 * `ctx.hooks` (the container factory's sibling channel). Read live at dispatch:
	 * return a getter over the component's own handlers, never a captured value.
	 * The platform treats it as `unknown`; the plugin casts it.
	 */
	commandHooks?: () => unknown;
}

export interface EditableLeaf {
	/** The block's source minus its trailing line ending — the editable text. */
	readonly sourceText: string;

	/**
	 * The live EFFECTIVE presentation mode — the leaf tier's mode read. The
	 * factory already gates itself in 'reading' (no reveal, no commits); a plain-
	 * mode component additionally binds `contenteditable` off this so its
	 * always-mounted source goes structurally inert (the memo fixture is the
	 * reference).
	 */
	getPresentationMode(): PresentationMode;

	// ── BlockComponent surface (mode-guarded; re-export as one-liners) ────────
	focus(offset: number): void;
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
	 * Clipboard interception with sibling-surface parity (editor.md § Clipboard).
	 * Bind on the source element only — a render-primary component's folded view has
	 * no source to slice, so it falls to native copy (its selection reads return empty
	 * while folded, and a folded middle block's raw is collected by the endpoint's
	 * handler in a cross-block copy).
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
	 * Plain mode: sync `sourceText` into the source element as a single text
	 * node, restoring the caret when the text changed under a live caret. Call
	 * from a `$effect` — reading `sourceText` inside tracks the node's raw.
	 */
	syncSource(): void;
	/** Effect-cleanup hook: park focus on the editor root when the source unmounts while focused. */
	parkFocus(el: HTMLElement | null): void;
}

/**
 * The node → metadata bridge (plus the component's `commandHooks`) a minted block
 * command resolves against on the leaf tier — the container factory's
 * `buildContainerKindTarget` sibling, extracted so both tiers build their command
 * context through a tested seam. `node`, `hooks`, and `editor` are read when this runs
 * (once per dispatch), so a node swap or a hook rebind is observed live;
 * `updateMetadata` rides the sanctioned commit ceremony, never a bypass. `pluginEditor`
 * resolves the per-plugin EditorContext by the kind's recorded owner (base per-instance
 * context for an ownerless kind, the `?? ''` arm).
 */
export function buildLeafCommandContext(
	deps: Pick<EditableLeafDeps, 'node' | 'index' | 'commandHooks'>,
	blockEdit: Pick<BlockEditActions, 'updateBlockMetadata'>,
	pluginEditor?: PluginEditorLookup
): Omit<BlockCommandContext, 'arg'> {
	return {
		node: deps.node,
		updateMetadata: (patch) => blockEdit.updateBlockMetadata(deps.index, patch),
		hooks: deps.commandHooks?.(),
		editor: pluginEditor?.(pluginKindOwner(deps.node.kind) ?? '')
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
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const {
		controller,
		pasteCoordinator,
		stickyColumn,
		reorder,
		selection,
		events: editorEvents
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationModeCtx } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		lifetime: editorLifetime,
		pluginEditor
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const getPresentationMode = (): PresentationMode => getPresentationModeCtx?.() ?? 'source';
	const isReading = () => getPresentationMode() === 'reading';
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);

	let composing = false;
	let preEditOffset = 0;
	let pendingCursor: number | null = null;

	const sourceText = (): string => trimTrailingLineEnding(deps.node.raw);

	const editableSurface = createEditableSurface({
		getEl: () => deps.getEl(),
		getAmbientLength: () => 0,
		// render-primary edits are ephemeral (one commit on blur); plain commits per keystroke.
		isInputSuppressed: () => mode === 'render-primary',
		// A zero-ambient, widget-free leaf: its DOM-text space IS its raw space,
		// so the backend door-mints across the two brands.
		backend: {
			getRaw: () => {
				const el = deps.getEl();
				const offset = el ? getCursorOffset(el) : null;
				return offset === null ? null : asRawOffset(offset);
			},
			setRaw: (offset) => {
				const el = deps.getEl();
				if (el) setCursorOffset(el, asDomTextOffset(offset));
			},
			buildRange: (start, end) => {
				const el = deps.getEl();
				return el ? createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end)) : null;
			}
		},
		getMyPath: () => deps.path,
		getIndex: () => deps.index,
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
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pluginEditor,
		getPresentationMode,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		pasteCoordinator,
		getFocusOffset: () => {
			const el = deps.getEl();
			const offset = el ? getSelectionFocusOffset(el) : null;
			return offset === null ? null : asRawOffset(offset);
		},
		getTextLen: () => (deps.getEl()?.textContent ?? '').length,
		readText: () => deps.getEl()?.textContent ?? '',
		commitInput: (text, preEdit, saved) => {
			// !isReading: the leaf is the seam — even if a plain-mode component keeps
			// its source editable in reading mode, nothing reaches the CST.
			if (mode === 'plain' && !isReading()) {
				blockEdit.updateBlockContent(
					deps.index,
					text + trailingLineEnding(deps.node.raw),
					preEdit,
					saved
				);
			}
		}
	});

	const surface = editableSurface.surface;
	const crossBlock = editableSurface.crossBlock;

	// The caret core; the swap is the component's reveal flag. Block commits on
	// blur via `commitReveal` (never the kernel's Escape-cancel `commit()`), so
	// only `reveal()` is driven here. Plain mode's swap thunks are inert.
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
		// One undo entry: the anchor is where the caret entered the edit; the
		// post-edit caret follows the edit position (a structural split lands it
		// in the block it falls in).
		blockEdit.updateBlockContent(
			deps.index,
			edited + trailingLineEnding(deps.node.raw),
			preEditOffset,
			edited.length
		);
	}

	function commitReveal(): void {
		if (mode !== 'render-primary' || !isRevealed()) return;
		// A cross-block selection sweeping through keeps the source revealed so its
		// rects measure real text; it folds when the selection clears.
		if (selection.isCrossBlock) return;
		// Only wired to onFocusOut — the block leaf folds on blur, never Escape-cancel.
		traceRevealFold('blur');
		const edited = deps.getEl()?.textContent ?? sourceText();
		deps.setRevealed!(false); // reactive re-render of the edited source
		if (edited === sourceText()) return; // pure view toggle, nothing for the CST
		commitSource(edited);
	}

	// ── BlockComponent surface ─────────────────────────────────────────────────

	function focus(offset: number): void {
		if (mode === 'render-primary') {
			// Reading mode: a rendered view has no source to reveal; focus is a no-op
			// and block-level traversal passes over.
			if (isReading()) return;
			void revealKernel.reveal(offset);
			return;
		}
		surface.focus(offset);
	}

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
				reorder.nudgeReorderUnit(deps.path, -1);
				return true;
			case 'block.moveDown':
				reorder.nudgeReorderUnit(deps.path, 1);
				return true;
			default:
				return false;
		}
	}

	const getCommandContext = () => buildLeafCommandContext(deps, blockEdit, pluginEditor);

	// ── View sync ──────────────────────────────────────────────────────────────

	// Chromium with `white-space: pre` won't paint a caret on the line after a
	// trailing `\n` unless something follows it; typed text routes before the
	// `\n`. A trailing `<br>` anchors the caret on the new line without touching
	// `textContent` (mirrors CodeBlock's anchor).
	function anchorTrailingNewline(el: HTMLElement): void {
		if (!el.textContent?.endsWith('\n')) return;
		const anchor = document.createElement('br');
		anchor.dataset.caretAnchor = '';
		el.appendChild(anchor);
	}

	function syncSource(): void {
		const text = sourceText();
		const el = deps.getEl();
		if (!el) return;
		const pending = pendingCursor;
		pendingCursor = null;
		if ((el.textContent ?? '') !== text) {
			el.textContent = text;
			anchorTrailingNewline(el);
			// Restore only under a live caret — an external rewrite (undo,
			// structural replace) must not steal focus.
			if (pending !== null && document.activeElement === el) {
				setCursorOffset(el, asDomTextOffset(pending));
			}
		}
	}

	// ── Event handlers ─────────────────────────────────────────────────────────

	// Splice `insert` over the source text node's [start, end), reseat the caret at
	// the splice end, and commit through the mode's path — plain commits per keystroke,
	// render-primary stays ephemeral until the blur fold. A DOM-text mutation keeps the
	// offset walk exact where a native Enter/cut/paste would inject <div>/<br> that
	// vanish from textContent (the leaf's Enter, cut, and paste all funnel here).
	function spliceSourceText(el: HTMLElement, start: number, end: number, insert: string): void {
		const text = el.textContent ?? '';
		el.textContent = text.slice(0, start) + insert + text.slice(end);
		anchorTrailingNewline(el);
		preEditOffset = start;
		setCursorOffset(el, asDomTextOffset(start + insert.length));
		if (mode === 'plain') editableSurface.onInput();
	}

	// ── Clipboard ────────────────────────────────────────────────────────────
	//
	// Sibling-surface parity: the leaf's DOM-text space IS its raw, so a single-block
	// copy is the selection string and a cut/paste splices verbatim into that text. The
	// tier declares no structural paste hook, so a paste never splits the block — the
	// commit re-parses the whole raw, re-splitting only where the grammar demands (a
	// memo's second line). Multiline pastes keep their newlines. Cross-block ops route
	// through the shared handlers the surface already wires.

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		// Reading mode copies the visible selection string, not the cross-block payload.
		if (isReading()) {
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			return;
		}
		if (writeCrossBlockCopy(e, { selection, getDoc, crossBlock })) return;
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();
		if (isReading()) {
			onCopy(e);
			return;
		}
		// Clipboard is written synchronously inside the cross-block prologue, before its
		// range delete awaits — a cut survives even if the delete is interrupted.
		if (await writeCrossBlockCut(e, { selection, getDoc, crossBlock })) return;

		const el = deps.getEl();
		if (!el) return;
		const sel = getSelectionOffsets(el);
		if (!sel || sel.start === sel.end) return;
		e.clipboardData?.setData('text/plain', (el.textContent ?? '').slice(sel.start, sel.end));
		spliceSourceText(el, sel.start, sel.end, '');
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		// preventDefault before any branch so a native paste never injects DOM (parity
		// with the sibling surfaces' synchronous prevent).
		e.preventDefault();
		if (isReading()) return;
		if (await crossBlock.handlePaste(e)) return;
		stickyColumn.reset();
		const el = deps.getEl();
		if (!el) return;
		const pastedText = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pastedText) return;
		const sel = getSelectionOffsets(el);
		const start = sel ? sel.start : (getCursorOffset(el) ?? (el.textContent ?? '').length);
		const end = sel ? sel.end : start;
		spliceSourceText(el, start, end, pastedText);
	}

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
				{ kind: deps.node.kind, runCommand, getCommandContext },
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
		// Shift-click extends a selection (handled once revealed); a plain click
		// reveals. Reading mode: no reveal, and no preventDefault — native selection
		// over the rendered view stays available.
		if (e.shiftKey || isReading()) return;
		e.preventDefault();
		void revealKernel.reveal(0);
	}

	return {
		get sourceText() {
			return sourceText();
		},

		getPresentationMode,

		focus,
		focusAtColumn,
		getCursorOffset: () => (isRevealed() ? surface.getCursorOffset() : null),
		getSelectedText: () => (isRevealed() ? surface.getSelectedText() : ''),
		setSelection: (start, end) => {
			if (isRevealed()) surface.setSelection(start, end);
		},
		measurePartialRects: (startOffset, endOffset) =>
			isRevealed() ? surface.measurePartialRects(startOffset, endOffset) : [],
		runCommand,

		onInput: editableSurface.onInput,
		onCompositionStart: editableSurface.onCompositionStart,
		onCompositionEnd: editableSurface.onCompositionEnd,
		onCopy,
		onCut,
		onPaste,
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
