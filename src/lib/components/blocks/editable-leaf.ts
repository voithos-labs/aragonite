/**
 * What a plugin's block component builds on: the same caret, IME, undo and selection behaviour
 * the built-in blocks have, in one factory, so a plugin never touches an editor context key.
 * `plain` commits on every keystroke; `render-primary` shows its source and commits on blur. A
 * source drawn with `renderSource` edits only its own DOM: every byte still enters the CST
 * through the single `updateBlockContent` in `commitReveal`. Call it synchronously during
 * initialisation. The contract is plugin-guide § The editable leaf.
 */

import { getContext } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';
import type { BlockEditActions } from '../../action-contracts';
import type { StickyColumnDirection } from '../../block-component';
import type { NodeView } from '../../core/node-views';
import {
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	type EditorPolicies,
	type EditorServices,
	type PluginEditorLookup
} from '../../editor-keys';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import {
	setCursorOffset,
	getCursorOffset,
	getSelectionOffsets,
	getRangeOffsets
} from '../../cursor/content-offsets';
import { handleSharedKeydown } from '../../selection/shared-keydown';
import {
	editableSurfaceAttributes,
	createEditableSurface,
	createClipboardHandlers,
	consumePendingRestore,
	withKeydownVerdict,
	type EditableSurfaceAttributes
} from './editable-surface';
import { wireSurfaceContexts } from './surface-wiring.svelte';
import { createContentOffsetBackend, anchorTrailingNewline } from './plain-text-backend';
import {
	CONTENT_EMPTY_ATTR,
	chromeFreeText,
	clampToLandableRaw,
	holdsOnlyMarkerChrome
} from '../../cursor/widget-offset';
import { parkFocusOnEditorRoot } from '../../selection/native-bridge';
import { assertInvariant } from '../../assert';
import { checkRenderedTextFidelity } from '../../invariants/render-fidelity';
import { resolveBinding } from '../../schema/commands';
import { eventToChord } from '../../schema/keybindings';
import { resetForPointerDown } from '../../selection/cross-block/pointer';
import { placeCaret } from '../../selection/caret-doors';
import { createSourceReveal } from '../../cursor/reveal-source';
import { traceRevealOpen, traceRevealFold } from '../../debug/interaction-trace';
import { documentLineEnding, trimTrailingLineEnding, trailingLineEnding } from '../../core/lines';
import type { PresentationMode } from '../../presentation-mode';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { type CommandId } from '../../schema/commands';
import { type BlockCommandContext } from '../../schema/block-commands';
import type { EditorContext } from '../../schema/plugin-install';
import { owningPluginEditor } from '../../schema/plugin-kind';
import { reorderRunCommand } from '../../editor-actions/reorder-action';
import { createTextBatch } from '../../editor-actions/commit/text-batch';

export type EditableLeafMode = 'plain' | 'render-primary';

/**
 * What the host component passes in. A function-valued field is read on every use, so a
 * structural edit or an undo is seen rather than snapshotted; `mode` and `singleLine` are read
 * once, at the factory call.
 */
export interface EditableLeafDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	/** The source contenteditable; null while unmounted (render-primary's rendered view). */
	getEl(): HTMLElement | null;
	mode?: EditableLeafMode;
	/** A kind whose bytes are one line: Enter splits the block rather than typing a newline. */
	singleLine?: boolean;

	/** render-primary only: the component owns the swap flag and both views. */
	isRevealed?(): boolean;
	setRevealed?(revealed: boolean): void;
	/**
	 * The mounted component's view-state hooks, handed to a plugin block command as
	 * `ctx.hooks`. Read live at dispatch: return a getter, never a captured value. The
	 * platform treats it as `unknown`; the plugin casts it.
	 */
	commandHooks?: () => unknown;
	/**
	 * Draws the source as DOM instead of one text node: fence lines the mode's CSS hides,
	 * highlight tokens. Must keep `fragment.textContent === text` (G1.28); the offset walk sees
	 * through spans, and hidden marker runs behave as they do in a code block.
	 */
	renderSource?(text: string): DocumentFragment;
	/**
	 * The surface's text after each edit the leaf applies itself (a painted source's typing,
	 * deleting, Enter). A render-primary host keeping a live preview reads this: the CST sees
	 * the edit only on blur, and a cancelled `beforeinput` fires no `input` event.
	 */
	onSourceEdit?(text: string): void;
	/**
	 * A source that is only its own markers (a `$$$$` with no body line), completed to a shape a
	 * caret can sit in, with where the caret goes; null leaves the bytes alone. Applied as the
	 * source is shown and after any edit that empties it, and committed on blur like any edit.
	 */
	completeBareSource?(text: string): { text: string; caret: number } | null;
}

/**
 * The one-spread source surface: `<div {...leaf.surfaceProps}>` wires every handler and attribute
 * a source contenteditable needs, so a consumer cannot drop one (a forgotten `oncompositionend`
 * breaks IME silently). Attachments under symbol keys carry the view's lifecycle rules: one text
 * node, so the offset traversal stays exact, and moving focus away on unmount.
 */
export interface EditableLeafSurfaceProps extends EditableSurfaceAttributes {
	tabindex: number;
	/** Reading mode makes a plain leaf's always-mounted source inert. */
	contenteditable: 'true' | 'false';
	spellcheck: 'false';
	oninput: () => void;
	onbeforeinput: (e: InputEvent) => void;
	onkeydown: (e: KeyboardEvent) => void | Promise<void>;
	oncopy: (e: ClipboardEvent) => void;
	oncut: (e: ClipboardEvent) => Promise<void>;
	onpaste: (e: ClipboardEvent) => Promise<void>;
	onpointerdown: (e: PointerEvent) => void;
	onfocusout: () => void;
	oncompositionstart: () => void;
	oncompositionend: () => void;
	/** Keeping the view in sync and moving focus away are Svelte attachments, symbol-keyed. */
	[attachment: symbol]: unknown;
}

/**
 * The one-spread rendered surface: `<div {...leaf.renderProps}>` on a render-primary block's
 * rendered view. One bundle rather than a handler apiece, because a rendered view wired only for
 * the click that shows the source consumes every chord while it holds focus, undo included. Both
 * do nothing while the source is up, so the spread may sit on a wrapper that stays either way.
 */
export interface EditableLeafRenderProps {
	/** Records where the pointer went down; the click is what shows the source, and a
	 *  shift-click extends a selection instead. */
	onpointerdown: (e: PointerEvent) => void;
	/** Show the source on a click that did not drag: one that moved is a selection. */
	onclick: (e: MouseEvent) => void;
	/** Chord dispatch at this block's kind: the global commands, then its own. */
	onkeydown: (e: KeyboardEvent) => void;
}

export interface EditableLeaf {
	/** The block's source minus its trailing line ending, which is the editable text. */
	readonly sourceText: string;

	/**
	 * Run `renderSource` again over the element's current text, keeping the caret, for a host
	 * that repaints as the user types (highlighting goes stale otherwise). No-op without it.
	 */
	repaintSource(): void;

	/** The source element in one spread: attributes, handlers and the two attachments. */
	surfaceProps: EditableLeafSurfaceProps;

	/** render-primary: the one-spread folded surface. */
	renderProps: EditableLeafRenderProps;

	/**
	 * The presentation mode in effect. The factory already refuses to act in
	 * 'reading' (no reveal, no commits); a plain-mode component additionally binds
	 * `contenteditable` off this so its always-mounted source goes structurally inert.
	 */
	getPresentationMode(): PresentationMode;

	/**
	 * The live editor theme name (`data-editor-theme`), for a leaf whose rendered half
	 * is drawn by something that emits its own colours rather than by CSS.
	 */
	getTheme(): string;

	/**
	 * This editor's options for the plugin that owns this block's kind, from the
	 * `{ plugin, options }` entry's channel, so two editors in one process configure the
	 * same kind differently. `unknown`, like `commandHooks`: the plugin narrows it.
	 */
	getOptions(): unknown;
	/** This editor's context for the plugin that owns this block's kind; undefined in a bare
	 *  harness. Its `computeInlineContent` reads the inline syntax this editor draws. */
	getEditor(): EditorContext | undefined;

	// ── BlockComponent surface (mode-guarded; re-export as one-liners) ────────
	focus(offset: number): void;
	parkCaret(offset: number): void;
	focusAtColumn(x: number, from: StickyColumnDirection): void;
	getCursorOffset(): number | null;
	getSelectedText(): string;
	setSelection(start: number, end: number): void;
	measurePartialRects(startOffset: number, endOffset: number): DOMRect[];
	runCommand(id: CommandId): boolean;

	// ── Programmatic edits ─────────────────────────────────────────────────────
	/** Insert Markdown at the caret exactly as pasting it here would, without the clipboard:
	 *  publish it as the component's `insertMarkdown` so `editor.insertMarkdown()` reaches
	 *  this leaf. Resolves once the paste has landed, false when it declined. */
	insertMarkdown(md: string): Promise<boolean>;
	/** Mount/focus the source with the caret at `offset` (plain mode: focus only). */
	reveal(offset?: number): Promise<void>;
	/** Commit edited source as one undo entry, fire and forget; the parse decides update / kind
	 *  change / structural split. */
	commitSource(edited: string): void;
}

/**
 * The node plus a metadata-commit route, and `commandHooks`, that a plugin block command runs
 * against on a leaf: the counterpart of the container factory's `buildContainerKindTarget`.
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
		editor: owningPluginEditor(pluginEditor, deps.getNode().kind)
	};
}

export function createEditableLeaf(deps: EditableLeafDeps): EditableLeaf {
	const mode: EditableLeafMode = deps.mode ?? 'plain';
	const singleLine = deps.singleLine ?? false;
	if (mode === 'render-primary' && (!deps.isRevealed || !deps.setRevealed)) {
		throw new Error('createEditableLeaf: render-primary mode requires isRevealed + setRevealed');
	}
	// Plain mode's source is always the editable view.
	const isRevealed = mode === 'render-primary' ? deps.isRevealed! : () => true;

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		focusActions,
		caretMemory,
		selection,
		getDoc,
		getBlockElByPath,
		getEditorRoot,
		pluginEditor,
		activePlugins,
		events: editorEvents,
		reading
	} = wiring.deps;
	const { reorder, inlineMenuCombobox } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const {
		theme: getThemeCtx,
		keybindingOverrides,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const getPresentationMode = reading.mode;
	const getTheme = (): string => getThemeCtx?.() ?? 'dark';
	// Resolved by the kind's recorded owner, like the command context's `editor`.
	const getEditor = (): EditorContext | undefined =>
		owningPluginEditor(pluginEditor, deps.getNode().kind);
	const getOptions = (): unknown => getEditor()?.options;
	const isReading = () => getPresentationMode() === 'reading';

	let composing = false;
	let pendingCursor: number | null = null;
	/** The bytes the open reveal was measured against; null while folded. */
	let revealedBase: string | null = null;

	const sourceText = (): string => trimTrailingLineEnding(deps.getNode().raw);

	const { backend, getFocusOffset, getTextLen, readText } = createContentOffsetBackend(() =>
		deps.getEl()
	);

	const editableSurface = createEditableSurface({
		...wiring.deps,
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
		// render-primary never restores a pending caret: focus has already left on
		// commit, and a re-render must not pull it back.
		setPendingCursor: (offset) => {
			if (mode === 'plain') pendingCursor = offset;
		},
		getFocusOffset,
		getTextLen,
		readText,
		commitInput: (text, preEdit, saved) => {
			if (mode === 'plain') {
				void blockEdit.updateBlockContent(
					deps.getIndex(),
					text + trailingLineEnding(deps.getNode().raw, documentLineEnding(getDoc())),
					preEdit,
					saved
				);
			}
		},
		handleBeforeInput: onBeforeInput
	});

	const surface = editableSurface.surface;
	const crossBlock = editableSurface.crossBlock;

	// The shared show-the-source primitive; the component's reveal flag says which view is up.
	// A leaf commits on blur through `commitReveal`, so only the primitive's `reveal()` is used.
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
		// The one place a block's source is shown: it is called only when none is
		// showing, so it fires once per open.
		showSource: () => {
			traceRevealOpen('leaf');
			revealedBase = sourceText();
			clearSourceHistory();
			deps.setRevealed?.(true);
		},
		showRendered: () => {
			revealedBase = null;
			clearSourceHistory();
			deps.setRevealed?.(false);
		}
	});

	// Every open goes through here rather than the primitive directly, so a source that is only
	// markers is completed (see `EditableLeafDeps.completeBareSource`) however it was opened.
	async function revealSource(atSourceOffset = 0): Promise<void> {
		await revealKernel.reveal(atSourceOffset);
		const el = deps.getEl();
		if (!el || !deps.completeBareSource || !isRevealed() || isReading()) return;
		const completed = deps.completeBareSource(el.textContent ?? '');
		if (!completed) return;
		paintSource(el, completed.text);
		deps.onSourceEdit?.(completed.text);
		setCursorOffset(el, asDomTextOffset(completed.caret));
	}

	// ── Commit ─────────────────────────────────────────────────────────────────

	// Returns the commit's own promise, so a caller that has to act on the committed bytes
	// (a single-line Enter's split) can wait for the write to land.
	function commitSource(edited: string): Promise<void> {
		// One undo entry, anchored at the caret before the last edit; the post-edit caret follows
		// the edit position.
		return Promise.resolve(
			blockEdit.updateBlockContent(
				deps.getIndex(),
				edited + trailingLineEnding(deps.getNode().raw, documentLineEnding(getDoc())),
				editableSurface.getPreEditOffset(),
				edited.length
			)
		);
	}

	// A blur during a live cross-block range is a drag that began in this source and left it. The
	// source hides one frame later, once the range has measured its text, unless focus came back.
	let foldFrame = 0;
	function foldAfterRange(): void {
		if (foldFrame) return;
		foldFrame = requestAnimationFrame(() => {
			foldFrame = 0;
			const el = deps.getEl();
			if (!isRevealed() || (el && el.contains(document.activeElement))) return;
			void commitReveal(true);
		});
	}

	async function commitReveal(force = false): Promise<void> {
		if (mode !== 'render-primary' || !isRevealed()) return;
		if (selection.isCrossBlock && !force) {
			foldAfterRange();
			return;
		}
		// Only wired to `onFocusOut`: a block leaf hides its source on blur, never on Escape.
		traceRevealFold('blur');
		const edited = deps.getEl()?.textContent ?? sourceText();
		const base = revealedBase;
		revealedBase = null;
		deps.setRevealed!(false); // reactive re-render of the edited source
		// Writes back only against the bytes the reveal measured: an undo or a `source` swap can
		// put another block at this index before the blur of the destroyed component arrives.
		if (base !== null && base !== sourceText()) return;
		if (edited === sourceText()) return; // pure view toggle, nothing for the CST
		await commitSource(edited);
	}

	// ── BlockComponent surface ─────────────────────────────────────────────────

	function parkCaret(offset: number): void {
		if (mode === 'render-primary') {
			// Reading mode: a rendered view has no source to reveal; focus is a no-op
			// and block-level traversal passes over.
			if (isReading()) return;
			void revealSource(offset);
			return;
		}
		surface.parkCaret(offset);
	}

	const focus = placeCaret(selection, parkCaret);

	// Sticky-column entry: mount the source, then land at the column nearest x
	// on the first or last visual line, as a code block does.
	function focusAtColumn(x: number, from: StickyColumnDirection): void {
		void (async () => {
			if (!isRevealed()) {
				if (isReading()) return;
				// Through the primitive like every other open, so this entry gets the same trace
				// pair and length check; it places a caret at 0, which the column lookup moves.
				await revealSource();
			}
			if (!deps.getEl()) return;
			surface.focusAtColumn(x, from);
		})();
	}

	function runCommand(id: CommandId): boolean {
		return reorderRunCommand(id, reorder, deps.getPath);
	}

	const getCommandContext = () => buildLeafCommandContext(deps, blockEdit, pluginEditor);

	// ── View sync ──────────────────────────────────────────────────────────────

	// The one place source bytes become DOM, so the painted text is checked against the source
	// here for every painter (G1.28). A markers-only source takes the code block's data attribute,
	// so its markers show while focused.
	function paintSource(el: HTMLElement, text: string): void {
		if (deps.renderSource) {
			const painted = deps.renderSource(text);
			assertInvariant('rendered-text-fidelity', () =>
				checkRenderedTextFidelity(painted.textContent ?? '', text)
			);
			el.replaceChildren(painted);
			el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
		} else {
			el.textContent = text;
		}
		anchorTrailingNewline(el);
	}

	function repaintSource(): void {
		const el = deps.getEl();
		if (!el || !deps.renderSource || composing) return;
		const offset = getCursorOffset(el);
		paintSource(el, el.textContent ?? '');
		if (offset !== null) setCursorOffset(el, asDomTextOffset(offset));
	}

	function syncSource(): void {
		const text = sourceText();
		const el = deps.getEl();
		if (!el) return;
		const pending = pendingCursor;
		pendingCursor = null;
		if ((el.textContent ?? '') !== text) {
			paintSource(el, text);
			// The local entries were taken against bytes an external rewrite just replaced.
			clearSourceHistory();
			// Restore only while a caret is live: a rewrite from outside (undo, structural
			// replace) must not steal focus.
			consumePendingRestore(el, pending, (offset) => setCursorOffset(el, asDomTextOffset(offset)));
		}
	}

	// ── Event handlers ─────────────────────────────────────────────────────────

	// The open reveal's own edit history (painted sources only): every splice pushes the text it
	// replaced, and the undo chords pop it back. Cleared as the reveal opens and folds.
	interface SourceEntry {
		text: string;
		caret: number;
	}
	let sourceUndo: SourceEntry[] = [];
	let sourceRedo: SourceEntry[] = [];
	// The document's own keystroke batch, not a second timer: a burst of typing inside the
	// reveal takes one entry there, so it takes one here.
	let batchBaseText = '';
	const sourceBatch = createTextBatch({
		pushSnapshot: (_leafPath, offset) => {
			sourceUndo.push({ text: batchBaseText, caret: offset });
			sourceRedo = [];
		}
	});

	function clearSourceHistory(): void {
		sourceBatch.interrupt();
		sourceUndo = [];
		sourceRedo = [];
	}

	function restoreSourceEntry(el: HTMLElement, from: SourceEntry[], to: SourceEntry[]): void {
		const entry = from.pop();
		if (!entry) return;
		// The restored text is what the next keystroke must snapshot, so it opens its own batch.
		sourceBatch.interrupt();
		to.push({ text: el.textContent ?? '', caret: getCursorOffset(el) ?? 0 });
		paintSource(el, entry.text);
		setCursorOffset(el, asDomTextOffset(entry.caret));
		deps.onSourceEdit?.(entry.text);
	}

	/**
	 * Every edit of a shown source records here. Only a keystroke's shape (at most one character
	 * replaced by at most one non-newline character) joins a burst; anything else takes its own entry.
	 */
	function recordSourceEdit(text: string, caret: number, keystroke: boolean): void {
		if (!keystroke) {
			sourceBatch.interrupt();
			sourceUndo.push({ text, caret });
			sourceRedo = [];
			return;
		}
		batchBaseText = text;
		sourceBatch.keystroke(deps.getPath(), caret);
	}

	// Splice `insert` over [start, end) of the source text and put the caret back: a native Enter,
	// cut or paste would inject <div>/<br> elements that vanish from textContent.
	function spliceSourceText(el: HTMLElement, start: number, end: number, insert: string): void {
		const text = el.textContent ?? '';
		const keystroke = end - start <= 1 && insert.length <= 1 && insert !== '\n';
		if (deps.renderSource) recordSourceEdit(text, getCursorOffset(el) ?? start, keystroke);
		const spliced = text.slice(0, start) + insert + text.slice(end);
		// Emptying the body leaves the same markers-only source a bare block arrives as, so this
		// edit applies the same completion that showing the source does.
		const completed = deps.completeBareSource?.(spliced) ?? null;
		const next = completed?.text ?? spliced;
		paintSource(el, next);
		deps.onSourceEdit?.(next);
		editableSurface.notePreEditOffset(start);
		setCursorOffset(el, asDomTextOffset(completed?.caret ?? start + insert.length));
		// Started once the edit has settled, so the gap measured is the one the user leaves.
		if (deps.renderSource && keystroke) sourceBatch.armPause();
		if (mode === 'plain') editableSurface.onInput();
	}

	// ── Clipboard ────────────────────────────────────────────────────────────

	// The leaf's DOM text is its raw, so copy writes the visible selection and cut and paste
	// splice verbatim; the commit's reparse splits the block where the grammar demands.
	const clipboard = createClipboardHandlers({
		caretMemory,
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
		pasteTail: (pastedText) => {
			const el = deps.getEl();
			if (!el) return;
			const sel = getSelectionOffsets(el);
			const start = sel ? sel.start : (getCursorOffset(el) ?? (el.textContent ?? '').length);
			const end = sel ? sel.end : start;
			spliceSourceText(el, start, end, pastedText);
		}
	});

	/** Resolve a chord at this leaf's kind and report whether it was consumed. Both views spend
	 *  it: undo belongs to the block whatever half of the swap holds focus. */
	const dispatchChord = (e: KeyboardEvent): boolean =>
		wiring.dispatchChord(e, { kind: deps.getNode().kind, runCommand, getCommandContext });

	async function handleKeydown(e: KeyboardEvent): Promise<void> {
		const el = deps.getEl();
		if (composing || !el) return;
		// Enter in a shown source commits it from here, with no input event to read the caret at.
		editableSurface.notePreEditOffset(getCursorOffset(el) ?? 0);

		// Undo inside a shown painted source steps through this session's own edits, which the
		// document sees as one entry written on blur. Resolved through the keymap like any chord.
		if (deps.renderSource && isRevealed()) {
			const command = historyCommandFor(e);
			if (command === 'history.undo' && sourceUndo.length > 0) {
				e.preventDefault();
				restoreSourceEntry(el, sourceUndo, sourceRedo);
				return;
			}
			if (command === 'history.redo' && sourceRedo.length > 0) {
				e.preventDefault();
				restoreSourceEntry(el, sourceRedo, sourceUndo);
				return;
			}
		}

		// Backspace in a painted source that holds only its markers deletes the block, as in a code
		// block. Only with whitespace or nothing before the caret, so a key pressed right after a
		// visible marker still edits that marker in source mode.
		if (e.key === 'Backspace' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const offset = deps.renderSource ? getCursorOffset(el) : null;
			const text = el.textContent ?? '';
			if (
				offset !== null &&
				(offset === 0 || /\s/.test(text[offset - 1] ?? '')) &&
				!hasSelectionIn(el) &&
				chromeFreeText(el).trim() === ''
			) {
				e.preventDefault();
				revealedBase = null;
				deps.setRevealed?.(false);
				const index = deps.getIndex();
				await blockEdit.deleteBlock(index);
				void focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if ((await handleSharedKeydown(e, editableSurface.sharedCtx)) || editableSurface.isDetached())
			return;

		if (dispatchChord(e)) return;

		// Enter stays inside the leaf as a literal newline (multiline source); it never splits
		// the block, and plain mode commits the insertion. A single-line leaf has nowhere to put
		// that byte, so it spends the keypress on the document instead.
		if (e.key === 'Enter') {
			e.preventDefault();
			if (isReading()) return;
			// Read before any fold: `setRevealed(false)` unmounts the element the offset lives in.
			const offset = getCursorOffset(el) ?? (el.textContent ?? '').length;
			if (singleLine) {
				// Through the hide, not a bare commit: it is the one place that decides whether an open
				// reveal's bytes may still be written, and the split reads `node.raw` after it.
				await commitReveal();
				await blockEdit.splitBlock(deps.getIndex(), offset);
				return;
			}
			spliceSourceText(el, offset, offset, '\n');
		}
	}

	/**
	 * A painted source takes plain text edits here, not from the browser, whose native insert
	 * replaces a lone `\n` text node and whose delete cannot see hidden markers. The range is
	 * clamped to where a caret can sit, so no edit reaches a hidden fence line.
	 */
	function onBeforeInput(e: InputEvent): void {
		if (!deps.renderSource || composing || e.isComposing) return;
		const el = deps.getEl();
		if (!el) return;
		let insert: string;
		switch (e.inputType) {
			case 'insertText':
				insert = e.data ?? '';
				break;
			case 'insertLineBreak':
			case 'insertParagraph':
				insert = '\n';
				break;
			case 'deleteContentBackward':
			case 'deleteContentForward':
			case 'deleteWordBackward':
			case 'deleteWordForward':
				insert = '';
				break;
			default:
				return;
		}
		const target = e.getTargetRanges()[0];
		const range = target ? getRangeOffsets(el, target) : null;
		if (!range) return;
		e.preventDefault();
		const start = clampToLandableRaw(el, range.start);
		const end = Math.max(start, clampToLandableRaw(el, range.end));
		spliceSourceText(el, start, end, insert);
	}

	function historyCommandFor(e: KeyboardEvent): string | undefined {
		const chord = eventToChord(e);
		if (!chord) return undefined;
		return resolveBinding(chord, deps.getNode().kind, keybindingOverrides(), activePlugins)
			?.command;
	}

	function hasSelectionIn(el: HTMLElement): boolean {
		const sel = window.getSelection();
		return Boolean(sel && !sel.isCollapsed && el.contains(sel.anchorNode));
	}

	function onPointerDown(e: PointerEvent): void {
		void crossBlock.handlePointerDown(e);
	}

	// The rendered view and the source are different strings, so only the kind can map a point
	// to a source offset: `caretTargetAtPoint` is that one declaration, and a kind naming none
	// reveals at the source start. The host, not the component root, is what the hook is bound to.
	function revealOffsetAt(e: MouseEvent): number {
		const host = getBlockElByPath(deps.getPath())?.closest('[data-block-path]');
		if (!(host instanceof HTMLElement)) return 0;
		const descriptor = tryGetBlockKindDescriptor(deps.getNode().kind);
		return descriptor?.caretTargetAtPoint?.(host, e.clientX, e.clientY)?.offset ?? 0;
	}

	// Pointer-down only records where it landed: showing the source there would consume every
	// drag that began on a rendered equation. The editor's own drag runs from that gesture,
	// through its root handler, and the click, a release that did not move, is what shows it.
	let renderPress: { x: number; y: number } | null = null;
	function onRenderPointerDown(e: PointerEvent): void {
		renderPress = e.shiftKey || isReading() ? null : { x: e.clientX, y: e.clientY };
	}

	function onRenderClick(e: MouseEvent): void {
		const press = renderPress;
		renderPress = null;
		if (!press || e.shiftKey || isReading()) return;
		if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) return;
		// Showing the source lands a caret, so the shared preamble has to run. Not through
		// `crossBlock.handlePointerDown`: that hit-tests against the source text, which the
		// rendered view is not.
		resetForPointerDown(selection, caretMemory, false);
		void revealSource(revealOffsetAt(e));
	}

	// A shown source owns the key and has already spent the chord, so a spread that stays
	// mounted must not run either handler again on the way up.
	const renderProps: EditableLeafRenderProps = {
		onpointerdown: (e) => {
			if (!isRevealed()) onRenderPointerDown(e);
		},
		onclick: (e) => {
			if (!isRevealed()) onRenderClick(e);
		},
		onkeydown: (e) => {
			if (!isRevealed()) void dispatchChord(e);
		}
	};

	// ── Source surface bundle ────────────────────────────────────────────────────

	const surfaceHandlers = {
		tabindex: 0,
		spellcheck: 'false' as const,
		oninput: editableSurface.onInput,
		onbeforeinput: editableSurface.onBeforeInput,
		onkeydown: withKeydownVerdict(handleKeydown),
		oncopy: clipboard.onCopy,
		oncut: clipboard.onCut,
		onpaste: clipboard.onPaste,
		onpointerdown: onPointerDown,
		onfocusout: () => void commitReveal(),
		oncompositionstart: editableSurface.onCompositionStart,
		oncompositionend: editableSurface.onCompositionEnd
	};

	// Mirrors a raw change from outside (undo, a structural replace) into the source. A shown
	// render-primary source is safe: nothing moves its raw before blur. No cleanup, so no focus move.
	const syncAttachment = () => {
		syncSource();
	};
	// Move focus away when the source unmounts. A separate, stable, untracked attachment, so
	// recomputing the spread never moves focus mid-edit.
	const parkAttachment = (el: HTMLElement) => () => parkFocusOnEditorRoot(el, getEditorRoot());

	// One key per attachment, taken once: the spread re-reads the bundle as the list under the
	// caret opens and closes, and Svelte re-runs an attachment only when its function changes.
	const syncKey = createAttachmentKey();
	const parkKey = createAttachmentKey();

	// Built on every read, so the combobox attributes follow the list. render-primary's
	// `contenteditable` is constant, since reveal never fires in reading mode.
	const buildSurfaceProps = (): EditableLeafSurfaceProps => ({
		...surfaceHandlers,
		...editableSurfaceAttributes(deps.getNode(), inlineMenuCombobox(deps.getPath())),
		contenteditable: mode === 'render-primary' || !isReading() ? 'true' : 'false',
		[syncKey]: syncAttachment,
		[parkKey]: parkAttachment
	});

	return {
		get sourceText() {
			return sourceText();
		},
		repaintSource,

		get surfaceProps() {
			return buildSurfaceProps();
		},
		renderProps,

		getPresentationMode,
		getTheme,
		getOptions,
		getEditor,

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
			// A folded leaf has no source text to measure, so any non-empty range covers the whole
			// rendered box, as an opaque container does (SELECTION_END exceeds every real start).
			if (endOffset <= startOffset) return [];
			const box = getBlockElByPath(deps.getPath());
			return box ? [box.getBoundingClientRect()] : [];
		},
		runCommand,

		insertMarkdown: clipboard.insertMarkdown,

		reveal: (offset = 0) => {
			if (mode !== 'render-primary') return Promise.resolve(surface.focus(offset));
			return isReading() ? Promise.resolve() : revealSource(offset);
		},
		commitSource: (edited) => void commitSource(edited)
	};
}
