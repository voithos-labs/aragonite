/**
 * What a plugin's block component builds on: the caret, IME, undo and selection behaviour the
 * built-in blocks have, in one factory, so a plugin never touches an editor context key. `plain`
 * commits on every keystroke; `render-primary` shows its source and commits on blur. Call it
 * synchronously during initialisation. `plugin-guide/editable-content.md` § The editable leaf.
 */

import { onDestroy, tick, untrack } from 'svelte';
import { createAttachmentKey } from 'svelte/attachments';
import type { EditableLeafBlockApi, StickyColumnDirection } from '../../../block-component';
import type { NodeView } from '../../../core/node-views';
import { asRawOffset } from '../../../caret/coordinate-spaces';
import { createSurfaceBackend } from './surface-backend';
import { handleSharedKeydown } from '../../../selection/shared-keydown';
import {
	createEditableSurface,
	consumePendingRestore,
	REMOVED_IN_PLACE,
	type EditableSurfaceAttributes
} from './editable-surface';
import type { ClipboardCopy } from './clipboard-step';
import { wireSurfaceContexts } from './surface-wiring.svelte';
import { anchorTrailingNewline, plainTextOf } from './plain-text-backend';
import {
	CONTENT_EMPTY_ATTR,
	chromeFreeText,
	clampToLandableRaw,
	holdsOnlyMarkerChrome,
	landableRawBounds,
	type RawRange
} from '../../../caret/widget-offset';
import {
	decidedDelete,
	deleteExtent,
	isDeleteInput,
	isMoveDelete,
	type DeleteAnswer,
	type DeleteIntent
} from '../../../caret/delete-extent';
import { lineEdgeOffset } from '../../../caret/visual-lines';
import { isAtMostOneCharacter } from '../../../core/text-units';
import { nativeRangeIn, parkFocusOnEditorRoot } from '../../../selection/native-bridge';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkRenderedTextFidelity } from '../../../invariants/render-fidelity';
import { resetForPointerDown } from '../../../selection/cross-block/pointer';
import { placeCaret } from '../../../selection/place-caret';
import { createSourceReveal } from '../../../caret/reveal-source';
import { traceRevealOpen, traceRevealFold } from '../../../debug/interaction-trace';
import { isBlankText, trimTrailingLineEnding, type LineEnding } from '../../../core/lines';
import type { PresentationMode } from '../../../presentation-mode';
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';
import {
	blockCommandTarget,
	type CommandRun,
	type KindCommandTarget
} from '../../../schema/block-commands';
import type { EditorContext } from '../../../schema/plugin-install';
import { componentPluginEditor, componentPluginOptions } from '../../../schema/block-kind-plugin';
import { createTextBatch } from '../../../editor-actions/commit/text-batch';
import type { Draft } from '../../../schema/drafts';

export type EditableLeafMode = 'plain' | 'render-primary';

/**
 * What the host component passes in. A function-valued field is read on every use, so an edit or
 * an undo is seen rather than snapshotted; `mode` and `singleLine` are read once. A render-primary
 * leaf owns its swap and passes both halves; a cast or JavaScript caller without them gets a throw.
 */
export type EditableLeafDeps = PlainLeafDeps | RenderPrimaryLeafDeps;

interface PlainLeafDeps extends LeafDepsBase {
	mode?: 'plain';
	/** A plain leaf's source is always the editable view, so it has no swap to own. */
	isRevealed?: never;
	setRevealed?: never;
}

interface RenderPrimaryLeafDeps extends LeafDepsBase {
	mode: 'render-primary';
	/** The component owns the swap flag and both views. */
	isRevealed(): boolean;
	setRevealed(revealed: boolean): void;
}

interface LeafDepsBase {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	/** The source contenteditable; null while unmounted (render-primary's rendered view). */
	getEl(): HTMLElement | null;
	/** A kind whose bytes are one line: Enter splits the block rather than typing a newline. */
	singleLine?: boolean;
	/** The component's view-state hooks, handed to a block command as `ctx.hooks` and read at
	 *  dispatch, so return live values. Typed `unknown`; the plugin casts it. */
	commandHooks?: () => unknown;
	/** Draws the source as DOM (hidden fence lines, highlight tokens) instead of one text node.
	 *  Must keep `fragment.textContent === text`, or caret offsets drift (G1.28). */
	renderSource?(text: string): DocumentFragment;
	/** The shown source's text once after each change, the browser's included, never mid-composition:
	 *  a live preview reads it, since the CST sees a render-primary edit only on blur. */
	onSourceEdit?(text: string): void;
	/** The source as the kind keeps it, asked on show and after every edit, with the caret carried
	 *  (a markers-only `$$$$` gains a body line); an added line takes `lineEnding`. Null keeps it. */
	reshapeSource?(
		text: string,
		caret: number,
		lineEnding: LineEnding
	): { text: string; caret: number } | null;
}

/**
 * The one-spread source surface: `<div {...leaf.surfaceProps}>` wires every handler and attribute
 * a source contenteditable needs, so a consumer cannot drop one (a forgotten `oncompositionend`
 * breaks IME silently). Attachments under symbol keys carry the view's lifecycle rules: one text
 * node, so the offset traversal stays exact, and moving focus away on unmount.
 */
export interface EditableLeafSurfaceProps extends EditableSurfaceAttributes {
	/** Reading mode makes a plain leaf's always-mounted source inert. */
	contenteditable: 'true' | 'false';
	spellcheck: 'false';
	oninput: (e: Event) => void;
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
	/** Everything the editor calls on this block, published as the component's one export:
	 *  `export const blockApi = leaf.blockApi;`. */
	readonly blockApi: EditableLeafBlockApi;

	/** The block's source minus its trailing line ending, which is the editable text. */
	readonly sourceText: string;

	/** The source element in one spread: attributes, handlers and the two attachments. */
	surfaceProps: EditableLeafSurfaceProps;

	/** render-primary: the one-spread folded surface. */
	renderProps: EditableLeafRenderProps;

	/** The presentation mode in effect. The factory already does nothing in reading mode; a
	 *  plain-mode component also binds `contenteditable` to it so its source goes inert. */
	getPresentationMode(): PresentationMode;

	/** The live editor theme name (`data-editor-theme`), for a rendered view drawn by something
	 *  that emits its own colours rather than by CSS. */
	getTheme(): string;

	/** This editor's options for the plugin owning this kind, so two editors can configure one
	 *  kind differently; the plugin's `defaults` when no editor is mounted. */
	getOptions<Options>(): Options;
	/** This editor's context for the plugin that owns this block's kind; undefined in a bare
	 *  harness. Its `computeInlineContent` reads the inline syntax this editor draws. */
	getEditor(): EditorContext | undefined;

	/** Mount/focus the source with the caret at `offset` (plain mode: focus only). */
	reveal(offset?: number): Promise<void>;
	/** Commit edited source as one undo entry, fire and forget; the parse decides update / kind
	 *  change / structural split. */
	commitSource(edited: string): void;
}

export function createEditableLeaf(deps: EditableLeafDeps): EditableLeaf {
	const mode: EditableLeafMode = deps.mode ?? 'plain';
	const singleLine = deps.singleLine ?? false;
	if (
		deps.mode === 'render-primary' &&
		(typeof deps.isRevealed !== 'function' || typeof deps.setRevealed !== 'function')
	) {
		throw new Error('createEditableLeaf: render-primary mode requires isRevealed and setRevealed');
	}
	const isRevealed = deps.mode === 'render-primary' ? deps.isRevealed : () => true;

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		caretMemory,
		caretWriter,
		selection,
		getBlockElByPath,
		getEditorRoot,
		reading,
		commands
	} = wiring.deps;
	const { pluginEditor } = commands;
	const { inlineMenuCombobox, drafts, presses } = wiring.services;
	const { theme: getTheme } = wiring.policies;
	const getPresentationMode = reading.mode;
	const getEditor = (): EditorContext | undefined =>
		componentPluginEditor(pluginEditor, deps.getNode().kind);
	const getOptions = <Options>(): Options =>
		componentPluginOptions(pluginEditor, deps.getNode().kind) as Options;
	const isReading = () => getPresentationMode() === 'reading';

	let composing = false;
	let pendingCursor: number | null = null;
	/** The open reveal's edit, which writes only over the bytes it opened on; null while folded. */
	let draft: Draft | null = null;
	const endDraft = (): void => {
		draft?.end();
		draft = null;
	};
	// Unregistered only: a swap's teardown blur still has to find the draft it dropped.
	onDestroy(() => draft?.end());

	const sourceText = (): string => trimTrailingLineEnding(deps.getNode().raw);

	const backend = createSurfaceBackend({ getEl: () => deps.getEl(), caretWriter });
	// A leaf's text is its raw, so a computed caret lands exactly where the edit put it.
	const setCaret = (offset: number): void =>
		backend.setRaw(asRawOffset(offset), { clamp: 'exact' });

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => deps.getEl(),
		// render-primary edits are ephemeral (one commit on blur); plain commits per keystroke.
		isInputSuppressed: () => mode === 'render-primary',
		backend,
		landCaret: (offset, clamp) => backend.setRaw(asRawOffset(offset), { clamp }),
		getNode: deps.getNode,
		getMyPath: deps.getPath,
		getIndex: deps.getIndex,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		// render-primary never restores a pending caret: focus has already left on
		// commit, and a re-render must not pull it back.
		requestCaret: (at) => {
			if (mode === 'plain') pendingCursor = at;
		},
		getFocusOffset: backend.getFocusOffset,
		getTextLen: () => plainTextOf(deps.getEl()).length,
		readText: () => plainTextOf(deps.getEl()),
		repaint: syncSource,
		handleKeydown,
		localHistory: (e) =>
			(e.inputType === 'historyUndo' || e.inputType === 'historyRedo') &&
			stepSourceHistory(e, e.inputType === 'historyUndo'),
		handleBeforeInput: onBeforeInput,
		deleteAtCaret,
		commandTarget: () => keyTarget,
		handleDeclinedDelete: spliceTargetRange,
		removeSelection: (range) => {
			removeRange(range);
			return REMOVED_IN_PLACE;
		}
	});

	const surface = editableSurface.surface;
	const crossBlock = editableSurface.crossBlock;

	// A leaf commits on blur through `commitReveal`, so only this primitive's `reveal()` is used.
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
		isRevealed,
		// Called only when no source is showing, so it fires once per open.
		showSource: () => {
			traceRevealOpen('leaf');
			draft?.end();
			draft = openDraft();
			clearSourceHistory();
			setRevealed(true);
		},
		showRendered: () => {
			endDraft();
			clearSourceHistory();
			setRevealed(false);
		},
		caretWriter
	});

	// A line the kind adds takes the block's ending, else the document's.
	function reshapeSource(text: string, caret: number) {
		return deps.reshapeSource?.(text, caret, editableSurface.lineEnding()) ?? null;
	}

	// A source handed over after the render that showed it (a view drawn outside Svelte) gets the
	// caret when it attaches.
	let pendingReveal: number | null = null;

	// Every open goes through here, so the kind reshapes its source however it was opened.
	async function revealSource(atSourceOffset = 0): Promise<void> {
		await revealKernel.reveal(atSourceOffset);
		const el = deps.getEl();
		if (!isRevealed() || isReading()) return;
		if (!el) {
			pendingReveal = atSourceOffset;
			return;
		}
		const reshaped = reshapeSource(el.textContent ?? '', atSourceOffset);
		if (!reshaped) return;
		paintSource(el, reshaped.text);
		reportSourceEdit(reshaped.text);
		setCaret(reshaped.caret);
	}

	// ── Commit ─────────────────────────────────────────────────────────────────

	function openDraft(): Draft {
		return drafts.open({
			seed: sourceText(),
			current: sourceText,
			close: (cause) => {
				if (cause === 'undo') saveBeforeUndo();
				else if (cause === 'mode-change') void commitReveal(true);
			}
		});
	}

	// The source stays shown through an undo: its edit lands as a step the undo then takes back.
	function saveBeforeUndo(): void {
		const edited = deps.getEl()?.textContent ?? sourceText();
		if (draft?.canWrite() && edited !== sourceText()) void commitSource(edited);
		draft = openDraft();
	}

	// Returns the commit's own promise, so a caller that has to act on the committed bytes
	// (a single-line Enter's split) can wait for the write to land.
	function commitSource(edited: string): Promise<boolean> {
		return editableSurface.writeText({
			text: edited,
			caretAfter: edited.length,
			intent: 'command',
			history: 'entry',
			mode: 'authored',
			source: 'source-commit'
		});
	}

	// A blur during a cross-block range is a drag leaving this source; it hides once the release's
	// render has landed, unless focus came back.
	let foldPending = false;
	async function foldAfterRange(): Promise<void> {
		if (foldPending) return;
		foldPending = true;
		await tick();
		foldPending = false;
		const el = deps.getEl();
		if (!isRevealed() || (el && el.contains(document.activeElement))) return;
		void commitReveal(true);
	}

	async function commitReveal(force = false): Promise<void> {
		if (mode !== 'render-primary' || !isRevealed()) return;
		if (selection.isCrossBlock && !force) {
			void foldAfterRange();
			return;
		}
		traceRevealFold('blur');
		const edited = deps.getEl()?.textContent ?? sourceText();
		const open = draft;
		endDraft();
		setRevealed(false);
		// An undo or a `source` swap can put another block at this index before the destroyed
		// component's blur arrives, so the edit lands only where its draft still can.
		if (open && !open.canWrite()) return;
		if (edited === sourceText()) return;
		await commitSource(edited);
	}

	// Forced, because a cross-block range would put the write off until the next render.
	function afterSourceCommit(run: () => void): void {
		if (mode !== 'render-primary' || !isRevealed()) return run();
		void commitReveal(true).then(run);
	}

	// ── BlockComponent methods ─────────────────────────────────────────────────

	function parkCaret(offset: number): void {
		if (mode === 'render-primary') {
			// Reading mode shows no source, so focus does nothing and traversal passes over.
			if (isReading()) return;
			void revealSource(offset);
			return;
		}
		surface.parkCaret(offset);
	}

	const focus = placeCaret(selection, caretWriter, parkCaret);

	function focusAtColumn(x: number, from: StickyColumnDirection): void {
		void (async () => {
			if (!isRevealed()) {
				if (isReading()) return;
				// Opens at offset 0; the column lookup below moves the caret.
				await revealSource();
			}
			if (!deps.getEl()) return;
			surface.focusAtColumn(x, from);
		})();
	}

	const getCommandContext = () => blockCommandTarget(deps, blockEdit, backend.getRaw);

	// ── View sync ──────────────────────────────────────────────────────────────

	// The text the view knows the source shows: the node's, which a fresh element is filled with, or
	// the last one reported. One change reports once, whatever order an engine fires its events in.
	let reported: string | null = null;
	function reportSourceEdit(text: string): void {
		reported = text;
		deps.onSourceEdit?.(text);
	}

	// Every painter's output passes here, so the text check covers them all (G1.28). A markers-only
	// source takes the code block's empty-content attribute, so its markers show while focused.
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
		reported = text;
		noteShownSource();
	}

	// The browser's own edits (an IME commit, a drop) skip the leaf's splice, so they repaint and
	// report here.
	function afterNativeEdit(): void {
		const el = deps.getEl();
		if (!el || composing || (el.textContent ?? '') === reported) return;
		repaintSource();
		reportSourceEdit(el.textContent ?? '');
	}

	// Every open and fold goes through here; a folded source is gone, so the hint judges the node.
	function setRevealed(value: boolean): void {
		if (!value) {
			pendingReveal = null;
			reported = null;
			editableSurface.noteShownSource(null);
		}
		deps.setRevealed?.(value);
	}

	// A shown render-primary source reaches the node only on blur, so the empty-block hint reads it.
	function noteShownSource(): void {
		const el = deps.getEl();
		if (mode === 'render-primary' && el)
			editableSurface.noteShownSource(() => el.textContent ?? '');
	}

	function repaintSource(): void {
		const el = deps.getEl();
		if (!el || !deps.renderSource || composing) return;
		const offset = backend.getRaw();
		const text = el.textContent ?? '';
		// A native edit (an IME commit) reaches the kind's reshape like the leaf's own edits do.
		const reshaped = offset === null ? null : reshapeSource(text, offset);
		paintSource(el, reshaped?.text ?? text);
		if (offset !== null) setCaret(reshaped?.caret ?? offset);
	}

	function syncSource(): void {
		const text = sourceText();
		const el = deps.getEl();
		if (!el) return;
		const pending = pendingCursor;
		pendingCursor = null;
		if ((el.textContent ?? '') !== text) {
			const heard = reported;
			paintSource(el, text);
			// An undo over text the view has heard is a change to it; a fresh element's fill is not.
			if (heard !== null && heard !== text) reportSourceEdit(text);
			// The local entries were taken against bytes an external rewrite just replaced.
			clearSourceHistory();
			// Restore only while a caret is live: a rewrite from outside (undo, structural
			// replace) must not steal focus.
			consumePendingRestore(el, pending, (offset) => setCaret(offset));
		}
	}

	// ── Event handlers ─────────────────────────────────────────────────────────

	// A shown painted source's own undo history, cleared as the source opens and hides.
	interface SourceEntry {
		text: string;
		caret: number;
	}
	let sourceUndo: SourceEntry[] = [];
	let sourceRedo: SourceEntry[] = [];
	// The document's keystroke batching, so a burst of typing takes one entry here as it does there.
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

	/** Undo or redo inside a shown painted source, while it has entries; false leaves the event to
	 *  the document's history. */
	function stepSourceHistory(e: Event, undo: boolean): boolean {
		const el = deps.getEl();
		if (!el || !deps.renderSource || !isRevealed()) return false;
		const [from, to] = undo ? [sourceUndo, sourceRedo] : [sourceRedo, sourceUndo];
		if (from.length === 0) return false;
		e.preventDefault();
		restoreSourceEntry(el, from, to);
		return true;
	}

	function restoreSourceEntry(el: HTMLElement, from: SourceEntry[], to: SourceEntry[]): void {
		const entry = from.pop();
		if (!entry) return;
		// The restored text is what the next keystroke must snapshot, so it opens its own batch.
		sourceBatch.interrupt();
		to.push({ text: el.textContent ?? '', caret: backend.getRaw() ?? 0 });
		paintSource(el, entry.text);
		setCaret(entry.caret);
		reportSourceEdit(entry.text);
	}

	/** Only a keystroke-shaped edit (one character at most, an emoji included, not a line break)
	 *  joins a typing burst; anything else takes its own undo entry. */
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
		const keystroke =
			isAtMostOneCharacter(text.slice(start, end)) &&
			isAtMostOneCharacter(insert) &&
			!/[\r\n]/.test(insert);
		if (deps.renderSource) recordSourceEdit(text, backend.getRaw() ?? start, keystroke);
		const spliced = text.slice(0, start) + insert + text.slice(end);
		// Every edit gets the reshape showing the source does: an emptied body is the same bare
		// source a new block arrives as.
		const reshaped = reshapeSource(spliced, start + insert.length);
		const next = reshaped?.text ?? spliced;
		paintSource(el, next);
		reportSourceEdit(next);
		setCaret(reshaped?.caret ?? start + insert.length);
		// Started after the edit, so the pause measured is the one the user leaves.
		if (deps.renderSource && keystroke) sourceBatch.armPause();
		if (mode === 'plain') editableSurface.commitInput();
	}

	// ── Clipboard ────────────────────────────────────────────────────────────

	// The leaf's DOM text is its raw, so copy writes a slice of it, hidden fence lines included, and
	// cut and paste splice verbatim; the commit's reparse splits the block where the grammar demands.
	function copyRange(e: ClipboardEvent): ClipboardCopy<RawRange> {
		const el = deps.getEl();
		const range = el ? backend.getRawSelection() : null;
		if (!el || !range || range.start === range.end) return null;
		e.clipboardData?.setData('text/plain', (el.textContent ?? '').slice(range.start, range.end));
		return { held: range };
	}

	function removeRange(range: RawRange): void {
		const el = deps.getEl();
		if (el) spliceSourceText(el, range.start, range.end, '');
	}

	const clipboard = editableSurface.clipboard({
		rangeArm: { copy: copyRange, remove: removeRange },
		pasteTail: (pastedText, { range }) => {
			const el = deps.getEl();
			if (!el) return;
			const end = (el.textContent ?? '').length;
			spliceSourceText(el, range?.start ?? end, range?.end ?? end, pastedText);
		}
	});

	/** Resolve a chord at this leaf's kind and report whether it was consumed. Both views spend
	 *  it: undo belongs to the block whatever half of the swap holds focus. */
	const keyTarget: KindCommandTarget = {
		get kind() {
			return deps.getNode().kind;
		},
		getCommandContext,
		getPath: deps.getPath,
		afterSourceCommit,
		afterSelectionRemoved: editableSurface.afterSelectionRemoved
	};
	const dispatchChord = (e: KeyboardEvent): boolean => wiring.dispatchChord(e, keyTarget);

	async function handleKeydown(e: KeyboardEvent): Promise<void> {
		const el = deps.getEl();
		if (composing || !el) return;

		// Undo inside a shown painted source steps through its own edits; the document sees them as
		// one entry written on blur.
		if (deps.renderSource && isRevealed()) {
			const command = wiring.resolveChord(e, deps.getNode().kind);
			if (command === 'history.undo' || command === 'history.redo') {
				if (stepSourceHistory(e, command === 'history.undo')) return;
			}
		}

		// Backspace in a markers-only painted source deletes the block, but only with whitespace or
		// nothing before the caret, so a Backspace right after a visible marker still edits it.
		if (e.key === 'Backspace' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const offset = deps.renderSource ? backend.getRaw() : null;
			const text = el.textContent ?? '';
			if (
				offset !== null &&
				(offset === 0 || /\s/.test(text[offset - 1] ?? '')) &&
				!nativeRangeIn(el) &&
				isBlankText(chromeFreeText(el))
			) {
				e.preventDefault();
				endDraft();
				setRevealed(false);
				await blockEdit.deleteBlock(deps.getIndex(), 'Backspace');
				return;
			}
		}

		if ((await handleSharedKeydown(e, editableSurface.sharedCtx)) || editableSurface.isDetached())
			return;

		if (dispatchChord(e)) return;

		if (e.key === 'Enter') {
			e.preventDefault();
			if (isReading()) return;
			// Enter isn't a command here, so it asks for a selection's removal itself.
			editableSurface.afterSelectionRemoved((afterRemoval) => {
				void breakLine(el, { afterRemoval });
				return true;
			});
		}
	}

	/** Enter at the caret: a literal newline in a multi-line source, while a one-line leaf has
	 *  nowhere to put one and splits the block instead. */
	async function breakLine(el: HTMLElement, run: CommandRun): Promise<void> {
		// Read before any fold: `setRevealed(false)` unmounts the element the offset lives in.
		const offset = backend.getRaw() ?? (el.textContent ?? '').length;
		if (!singleLine) return spliceSourceText(el, offset, offset, editableSurface.lineEnding());
		// `commitReveal` decides whether the shown bytes may still be written, and the split reads
		// `node.raw` after it.
		await commitReveal();
		await blockEdit.splitBlock(deps.getIndex(), offset, run);
	}

	/** A painted source applies text edits itself: the browser's insert replaces a lone `\n` text
	 *  node and its delete cannot see hidden markers. Clamping keeps edits off hidden fence lines. */
	function onBeforeInput(e: InputEvent): void {
		// A delete the editor decides is `deleteAtCaret`'s, and reaches the splice only if declined.
		if (!decidedDelete(e.inputType)) spliceTargetRange(e);
	}

	function spliceTargetRange(e: InputEvent): void {
		if (!deps.renderSource || composing || e.isComposing) return;
		const el = deps.getEl();
		if (!el) return;
		const insert = sourceInsertion(e.inputType, e.data);
		if (insert === null) return;
		const target = e.getTargetRanges()[0];
		const range = target ? backend.rawRangeOf(target) : null;
		if (!range) return;
		e.preventDefault();
		const start = clampToLandableRaw(el, range.start);
		const end = Math.max(start, clampToLandableRaw(el, range.end));
		spliceSourceText(el, start, end, insert);
	}

	/** What an input writes over its target range in a painted source; null leaves it alone. */
	function sourceInsertion(inputType: string, data: string | null): string | null {
		if (isDeleteInput(inputType)) return isMoveDelete(inputType) ? null : '';
		if (inputType === 'insertText') return data ?? '';
		const breaks = inputType === 'insertLineBreak' || inputType === 'insertParagraph';
		return breaks ? editableSurface.lineEnding() : null;
	}

	/** A collapsed delete takes what the delete rule names in the DOM's text, which a shown
	 *  render-primary source reaches the node with only on blur, kept off the lines the mode hides. */
	function deleteAtCaret(caret: number, intent: DeleteIntent): DeleteAnswer {
		const el = deps.getEl();
		if (!el) return 'declined';
		const text = el.textContent ?? '';
		const span = deleteExtent(intent, {
			text,
			caret,
			bounds: landableRawBounds(el) ?? { start: 0, end: text.length },
			lineEdge: (side) => lineEdgeOffset(el, caret, side, caretWriter)
		});
		if (!span) return 'at-edge';
		spliceSourceText(el, span.start, span.end, '');
		return 'taken';
	}

	function onPointerDown(e: PointerEvent): void {
		void crossBlock.handlePointerDown(e);
	}

	// The rendered view and the source are different strings, so only the kind's
	// `caretTargetAtPoint` can map a point to a source offset; without one the source opens at 0.
	function revealOffsetAt(e: MouseEvent): number {
		const host = getBlockElByPath(deps.getPath())?.closest('[data-block-path]');
		if (!(host instanceof HTMLElement)) return 0;
		const descriptor = tryGetBlockKindDescriptor(deps.getNode().kind);
		return descriptor?.caretTargetAtPoint?.(host, e.clientX, e.clientY)?.offset ?? 0;
	}

	// Pointer-down only records where it landed, so a drag starting on the rendered view stays a
	// selection drag; the click, a release that did not move, shows the source.
	let renderPressed = false;
	function onRenderPointerDown(e: PointerEvent): void {
		renderPressed = !e.shiftKey && !isReading();
	}

	function onRenderClick(e: MouseEvent): void {
		const pressed = renderPressed;
		renderPressed = false;
		if (!pressed || e.shiftKey || isReading() || presses.travelled(e)) return;
		// Showing the source places a caret, so the pointer-down reset runs; not through
		// `crossBlock.handlePointerDown`, which hit-tests the source text, not the rendered view.
		resetForPointerDown(selection, caretWriter, caretMemory, false);
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

	// ── Source element props ─────────────────────────────────────────────────────

	const surfaceHandlers = {
		spellcheck: 'false' as const,
		oninput: (e: Event) => {
			editableSurface.onInput(e);
			noteShownSource();
			if (!(e as InputEvent).isComposing) afterNativeEdit();
		},
		onbeforeinput: editableSurface.onBeforeInput,
		onkeydown: editableSurface.onKeyDown,
		oncopy: clipboard.onCopy,
		oncut: clipboard.onCut,
		onpaste: clipboard.onPaste,
		onpointerdown: onPointerDown,
		onfocusout: () => void commitReveal(),
		oncompositionstart: editableSurface.onCompositionStart,
		oncompositionend: () => {
			editableSurface.onCompositionEnd();
			afterNativeEdit();
		}
	};

	// Mirrors a raw change from outside (undo, a structural replace) into the source; nothing moves
	// a shown render-primary source's raw before blur.
	const syncAttachment = () => {
		syncSource();
		const at = pendingReveal;
		pendingReveal = null;
		if (at !== null) untrack(() => void revealSource(at));
	};
	// Its own stable attachment, so recomputing the spread never moves focus mid-edit.
	const parkAttachment = (el: HTMLElement) => () => parkFocusOnEditorRoot(el, getEditorRoot());

	// One key per attachment, taken once: the spread re-reads the bundle as the list under the
	// caret opens and closes, and Svelte re-runs an attachment only when its function changes.
	const syncKey = createAttachmentKey();
	const parkKey = createAttachmentKey();

	// Built on every read, so the combobox attributes follow the list. A render-primary source is
	// never shown in reading mode, so its `contenteditable` stays true.
	const buildSurfaceProps = (): EditableLeafSurfaceProps => ({
		...surfaceHandlers,
		...editableSurface.attributes(inlineMenuCombobox(deps.getPath())),
		contenteditable: mode === 'render-primary' || !isReading() ? 'true' : 'false',
		[syncKey]: syncAttachment,
		[parkKey]: parkAttachment
	});

	const blockApi = {
		get editable() {
			return tryGetBlockKindDescriptor(deps.getNode().kind)?.editable ?? true;
		},
		focusable: true,
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
			// A hidden source has no text to measure, so any non-empty range covers the rendered box.
			if (endOffset <= startOffset) return [];
			const box = getBlockElByPath(deps.getPath());
			return box ? [box.getBoundingClientRect()] : [];
		},
		insertMarkdown: clipboard.insertMarkdown,
		insertPlainText: clipboard.insertPlainText,
		typeText: surface.typeText,
		afterSourceCommit,
		afterSelectionRemoved: editableSurface.afterSelectionRemoved,
		getCommandContext
	} satisfies EditableLeafBlockApi;

	return {
		blockApi,
		get sourceText() {
			return sourceText();
		},
		get surfaceProps() {
			return buildSurfaceProps();
		},
		renderProps,

		getPresentationMode,
		getTheme,
		getOptions,
		getEditor,

		reveal: (offset = 0) => {
			if (mode !== 'render-primary') return Promise.resolve(surface.focus(offset));
			return isReading() ? Promise.resolve() : revealSource(offset);
		},
		commitSource: (edited) => void commitSource(edited)
	};
}
