<script lang="ts">
	import { getContext, tick } from 'svelte';
	import { type BlockComponent } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import {
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type CodeRunRequest,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { asRawOffset } from '../../../cursor/coordinate-spaces';
	import {
		CONTENT_EMPTY_ATTR,
		holdsOnlyMarkerChrome,
		selectRawRange,
		type RawRange
	} from '../../../cursor/widget-offset';
	import { createSurfaceBackend } from '../../../cursor/surface-backend';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		createClipboardHandlers,
		consumePendingRestore,
		editableSurfaceAttributes,
		withKeydownVerdict
	} from '../editable-surface';
	import { wireSurfaceContexts, useParkFocusOnUnmount } from '../surface-wiring.svelte';
	import { anchorTrailingNewline, plainTextOf } from '../plain-text-backend';
	import { renderCodeBlock, sliceFencedCode } from './code-renderer';
	import {
		getLineLeadingWhitespace,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code-editing';
	import { indentLines, dedentLines, type IndentResult } from './code-indent';
	import { computeCodeEnter } from './code-enter';
	import { computeAutoPair } from './code-beforeinput';
	import {
		fenceShapeOf,
		reconcileFenceWrite,
		writeFenceInfo
	} from '../../../schema/fenced-code-raw';
	import { hidesMarkers } from '../../../presentation-mode';
	import CodeBlockRail from './CodeBlockRail.svelte';
	import { computeFenceExit, computeTypedFenceExit } from './code-fence-exit';
	import {
		classifyFenceBoundary,
		bodyWindow,
		clampCaretToBody,
		clampEnterOffsetToBody,
		clampRangeToBody,
		computeFenceRangedEdit,
		crossesFenceBoundary,
		fenceEditSpan,
		isStructureOnlyRange
	} from './code-fence-boundary';
	import { metadataOf, type CstNode } from '../../../core/nodes';
	import {
		documentLineEnding,
		trimTrailingLineEnding,
		trailingLineEnding
	} from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { nodeAt, emptyParagraph } from '../../../tree-operations';
	import { type CommandId } from '../../../schema/commands';
	import { reorderRunCommand } from '../../../editor-actions/reorder-action';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		focusActions,
		controller,
		pasteCoordinator,
		caretMemory,
		selection,
		getDoc,
		getEditorRoot,
		activePlugins,
		events: editorEvents,
		reading
	} = wiring.deps;
	// The ending a line written into this block takes: its own, else the document's.
	const blockEnding = () => trailingLineEnding(node.raw, documentLineEnding(getDoc()));
	const { reorder, menuPresence } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { onPasteImage, onRunCode, codeMenuItems } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const presentationMode = $derived(reading.mode());
	const readOnly = $derived(presentationMode === 'reading');
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';

	const backend = createSurfaceBackend({ getEl: () => el ?? null });

	const editableSurface = createEditableSurface({
		...wiring.deps,
		getEl: () => el ?? null,
		backend,
		// A fence line is structure: a column landing stays in the body, and a placed offset
		// that reaches a fence line clamps onto editable content.
		columnWindow: () => bodyWindow(node),
		clampLanding: (offset) => clampCaretToBody(node, offset),
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		},
		getFocusOffset: backend.getFocusOffset,
		getTextLen: () => plainTextOf(el).length,
		readText: () => plainTextOf(el),
		// Gives back the caret the reconciled bytes need: the write rule can grow the
		// fence or drop a character, either of which moves the caret off the DOM's.
		commitInput: (text, preEdit, savedOffset) => commitDisplay(text, preEdit, savedOffset),
		handleBeforeInput: onBeforeInput
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export const focus = editableSurface.surface.focus;
	export const parkCaret = editableSurface.surface.parkCaret;
	export const focusAtColumn = editableSurface.surface.focusAtColumn;
	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	/**
	 * The one place this block commits displayed text: no gesture calls `updateBlockContent`
	 * directly (checked by `lint/code-commit-funnel`). The fence rule runs inside rather than at
	 * each caller, so every gesture gets fence reconciliation without asking.
	 */
	function commitDisplay(display: string, undoAnchor: number, caret: number): number {
		const written = reconcileFenceWrite({
			display,
			caret,
			fence: fenceShapeOf(node),
			mode: 'authored'
		});
		void blockEdit.updateBlockContent(index, written.display + blockEnding(), undoAnchor);
		return written.caret;
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node, activePlugins));
		anchorTrailingNewline(el);
		// The container's own data attribute, and the only thing that still reads emptiness:
		// both the marker-hiding CSS and the caret traversal key off it. The side gutter does
		// not check it, since a fence with no content gets one either way.
		el.toggleAttribute(CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome(el));
		lastRenderedRaw = node.raw;

		// Restore only while this block still holds focus: an edit reparsing to multiple
		// blocks moves the caret to the split-off sibling, and a blur would otherwise yank
		// the global selection back. The pending fields clear either way, never set again.
		if (pendingSelection !== null) {
			consumePendingRestore(el, pendingSelection, (range) =>
				selectRawRange(el!, range.start, range.end)
			);
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				backend.setRaw(asRawOffset(offset), { clamp: 'exact' })
			);
			pendingCursorOffset = null;
		}
	});

	useParkFocusOnUnmount(() => el ?? null, getEditorRoot);

	// ── The rail ──────────────────────────────────────────────────────────────

	// The side gutter stands in for fence markers the mode does not draw, so source mode never gets
	// one. An empty fence gets it too, dimmed markers and all: the picker is how a language is set.
	const showRail = $derived(hidesMarkers(presentationMode));
	const infoString = $derived(metadataOf(node, 'fencedCode').info);

	/** The fence body alone, which is what a host runs or a copy writes, never the opener
	 *  and closer lines, which are this block's syntax rather than its content. */
	function bodyText(): string {
		return sliceFencedCode(node).body;
	}

	function runRequest(): CodeRunRequest {
		return { code: bodyText(), info: infoString, path: myPath };
	}

	/**
	 * Offer the language picker on the first focus of a fence with no language and no body. Keyed
	 * on focus, not on the edit that made the fence: a block an insert command creates mounts after
	 * that commit, so the caret arriving is the one signal every path shares.
	 */
	let autoOpenLanguage = $state(false);
	let languageOffered = false;
	function onSurfaceFocus(): void {
		if (languageOffered || readOnly || !showRail) return;
		languageOffered = true;
		// A caret that stepped into an existing fence is passing through, and a picker would trap
		// it; a click or an insert command records no arrival key, and that is the user authoring.
		const steppedIn = metadataOf(node, 'fencedCode').closed && caretMemory.side() !== null;
		const offerLanguage = infoString === '' && bodyText().trim() === '' && !steppedIn;
		// Deferred past the commit's own caret placement, which focuses this block a second time
		// and would blur a picker opened on the first. A bare fence is completed before it opens.
		void tick().then(() => {
			const completed = completeBareFence();
			if (!offerLanguage) return;
			if (completed) {
				void tick().then(() => {
					autoOpenLanguage = true;
				});
			} else {
				autoOpenLanguage = true;
			}
		});
	}

	/**
	 * A fence with no body line (a just-typed opener, or an opener against its closer) has nowhere
	 * for a caret, so it is written as opener, one empty body line and closer, with the caret on
	 * that line. True when it wrote.
	 */
	function completeBareFence(): boolean {
		if (!el) return false;
		const meta = metadataOf(node, 'fencedCode');
		const slice = sliceFencedCode(node);
		const text = getDisplayText();
		const ending = blockEnding();
		const offset = backend.getRaw() ?? 0;
		if (!meta.closed) {
			if (slice.body.trim() !== '') return false;
			const closer = meta.fenceMarker.repeat(meta.fenceLength);
			const completed = text + ending + ending + closer;
			pendingCursorOffset = commitDisplay(completed, offset, text.length + ending.length);
			return true;
		}
		if (slice.body !== '') return false;
		const openerLength = slice.openerLine.length;
		const completed = text.slice(0, openerLength) + ending + text.slice(openerLength);
		pendingCursorOffset = commitDisplay(completed, offset, openerLength);
		return true;
	}

	async function copyBody(): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(bodyText());
			return true;
		} catch {
			// A denied or absent clipboard is the host's business, not an editor error: the
			// affordance simply reports nothing copied.
			return false;
		}
	}

	// What the language chip writes: the opener's info string, through the one commit above so
	// the fence rule runs over it, kept apart so no typing on either side joins its undo entry.
	function commitLanguage(info: string): void {
		// Bytes that did not change, or were refused, close the field without writing: no undo
		// entry and no edit event. The starting value is `meta.info` trimmed, so comparing bytes
		// alone would let a bare Enter respell a fence whose info string carries padding.
		if (info === infoString) {
			returnCaretToBody();
			return;
		}
		const display = getDisplayText();
		const written = writeFenceInfo(display, info, fenceShapeOf(node));
		const bodyStart = clampCaretToBody(node, 0);
		if (written !== null && written !== display) {
			controller.isolateUndoEntry(() => commitDisplay(written, bodyStart, bodyStart));
		}
		returnCaretToBody();
	}

	/**
	 * Put the caret back at the body start after the side gutter closes. Not `focus(0)`: on an
	 * unclosed fence the opener run counts as content, so offset 0 sits before the backticks;
	 * `clampRangeToBody` clamps unconditionally.
	 */
	function returnCaretToBody(): void {
		// Focus first and place the caret through the pending-caret field the render effect
		// reads. A bare `focus()` after a tick races the commit's own re-render, which replaces
		// every child of the container and loses the caret.
		el?.focus({ preventScroll: true });
		void tick().then(() => {
			// Read the body after the commit lands. Writing a language lengthens the opener, so
			// an offset measured against the node from before the commit points into the info
			// string that just grew, putting the caret inside `js` where typing splits it.
			const at = clampRangeToBody(node, { start: 0, end: 0 }).start;
			pendingCursorOffset = at;
			focus(at);
		});
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	// An IME deletes the selection as it starts composing, and the `insertCompositionText`
	// beforeinput event is not cancelable, so a selection crossing a fence is shrunk onto its
	// body here, before the composition takes over.
	function onCompositionStart(): void {
		const sel = backend.getRawSelection();
		if (sel && crossesFenceBoundary(node, sel)) {
			const span = fenceEditSpan(node, sel);
			setSelection(span.start, span.end);
		}
		editableSurface.onCompositionStart();
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		if (guardFenceRangedEdit(e)) return;
		// Soft break: Shift+Enter, and mobile/IME insertLineBreak without a keydown.
		// Gated on !composing so an IME emitting it mid-composition does not sync.
		if (e.inputType === 'insertLineBreak' && !composing && el) {
			e.preventDefault();
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: enterSpliceSpan(currentRange()),
				mode: 'soft',
				ending: blockEnding()
			});
			pendingCursorOffset = commitDisplay(
				result.newText,
				editableSurface.getPreEditOffset(),
				result.newCursor
			);
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = backend.getRawSelection();
		const offset = selOffsets ? selOffsets.start : (backend.getRaw() ?? 0);

		const meta = metadataOf(node, 'fencedCode');
		const collapsed = !selOffsets || selOffsets.start === selOffsets.end;
		const typedExit = collapsed
			? computeTypedFenceExit({ text, offset, meta, typed: data })
			: { kind: 'none' as const };
		if (typedExit.kind === 'exitWithEdit') {
			e.preventDefault();
			commitDisplay(typedExit.newText, offset, offset);
			exitDownward();
			return;
		}

		const result = computeAutoPair({
			text,
			selection: selOffsets ?? { start: offset, end: offset },
			typed: data,
			unclosedBacktickFence: meta.closed === false && meta.fenceMarker === '`'
		});
		if (!result) return;

		e.preventDefault();
		if (result.kind === 'skip') {
			backend.setRaw(asRawOffset(result.caretOffset), { clamp: 'exact' });
			return;
		}
		if (result.kind === 'wrap') {
			// Both endpoints sit inside the body, so whatever is inserted ahead of the
			// wrap's start moves its end by the same amount.
			const start = commitDisplay(
				result.newText,
				editableSurface.getPreEditOffset(),
				result.selection.start
			);
			const shift = start - result.selection.start;
			pendingSelection = { start, end: result.selection.end + shift };
		} else {
			pendingCursorOffset = commitDisplay(
				result.newText,
				editableSurface.getPreEditOffset(),
				result.caretOffset
			);
		}
	}

	// ── Fence-crossing edits ──────────────────────────────────────────────────

	/**
	 * Where an Enter-family splice lands (the `code.newline` command and the soft
	 * break): a caret clamps out of the fence lines, a selection is replaced on its
	 * body span like every other ranged edit here.
	 */
	function enterSpliceSpan(range: RawRange): RawRange {
		if (range.start !== range.end) return fenceEditSpan(node, range);
		const at = clampEnterOffsetToBody(node, range.start);
		return { start: at, end: at };
	}

	/**
	 * The one check for every browser edit that rewrites a range here: delete, forward delete,
	 * typing over a selection, word delete and drag. One that crosses a fence line is moved
	 * onto the body rather than left to splice the fence away.
	 */
	function guardFenceRangedEdit(e: InputEvent): boolean {
		if (composing || !el) return false;
		const range = pendingEditRange(e);
		if (!range) return false;
		if (!crossesFenceBoundary(node, range)) return guardHiddenFenceDelete(e, range);

		e.preventDefault();
		const insert = rangedEditInsertion(e, fenceEditSpan(node, range));
		if (insert === null) return true;
		const edit = computeFenceRangedEdit(node, range, insert);
		if (!edit) return true;
		pendingCursorOffset = commitDisplay(
			edit.newText,
			editableSurface.getPreEditOffset(),
			edit.newCursor
		);
		return true;
	}

	/**
	 * A delete while the fence lines are hidden is applied here, clamped to the body: Chromium,
	 * deleting the last visible character of a line, also removes the unrendered fence line beside it.
	 */
	function guardHiddenFenceDelete(e: InputEvent, range: RawRange): boolean {
		if (!showRail || !/^delete(?!By)/.test(e.inputType)) return false;
		e.preventDefault();
		const span = clampRangeToBody(node, range);
		if (span.end > span.start) {
			const text = getDisplayText();
			pendingCursorOffset = commitDisplay(
				text.slice(0, span.start) + text.slice(span.end),
				backend.getRaw() ?? 0,
				span.start
			);
		}
		return true;
	}

	/**
	 * What the pending edit will rewrite. `getTargetRanges()` is the authority, since a word
	 * delete at a collapsed caret reports the word rather than the caret; it is feature-detected
	 * because jsdom does not implement it.
	 */
	function pendingEditRange(e: InputEvent): RawRange | null {
		const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
		if (targets.length > 0) return backend.rawRangeOf(targets[0]);
		const selected = backend.getRawSelection();
		if (selected) return selected;
		const caret = backend.getRaw();
		return caret === null ? null : { start: caret, end: caret };
	}

	/**
	 * The text an input type writes over its span, or null to refuse it (prevented, nothing
	 * committed). A `dataTransfer` payload is refused: it would skip the paste transforms (G4.11).
	 */
	function rangedEditInsertion(e: InputEvent, span: RawRange): string | null {
		if (e.inputType.startsWith('delete')) return '';
		switch (e.inputType) {
			case 'insertText':
				return e.data ?? '';
			case 'insertLineBreak':
				return blockEnding();
			// The keydown path auto-indents (computeCodeEnter 'normal'), and a mobile or
			// IME insertParagraph is the same gesture arriving without a keydown.
			case 'insertParagraph':
				return blockEnding() + getLineLeadingWhitespace(getDisplayText(), span.start);
			default:
				return null;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		if ((await handleSharedKeydown(e, sharedCtx)) || editableSurface.isDetached()) return;

		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;
	}

	const onKeyDownTraced = withKeydownVerdict(onKeyDown);

	// ── Commands ────────────────────────────────────────────────────────

	export function runCommand(id: CommandId): boolean {
		if (reorderRunCommand(id, reorder, () => myPath)) return true;
		switch (id) {
			case 'format.toggleStrong':
			case 'format.toggleEmphasis':
			case 'format.toggleStrikethrough':
			case 'format.toggleCode':
			case 'link.openCard':
				return true; // code blocks carry no inline constructs; swallow to stop the browser default
			case 'code.newline':
				return codeNewline();
			case 'code.indent':
				indentSelection();
				return true;
			case 'code.dedent':
				dedentSelection();
				return true;
			case 'code.backspace':
				return codeBackspace();
			case 'code.delete':
				return codeDelete();
			default:
				return false;
		}
	}

	function codeBackspace(): boolean {
		if (!el || backend.getRawSelection() !== null) return false;
		const offset = backend.getRaw() ?? 0;
		// offset===0 is the universal contract; the classifyFenceBoundary check catches the
		// fence boundary, where a native Backspace would delete the opener's terminating `\n`.
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			// At the top of an empty fence the key can only mean the block, so it goes; a fence
			// with a body keeps the step-out, since one keypress must never take code with it.
			if (bodyText().trim() === '') {
				void blockEdit.deleteBlock(index);
				focusActions.moveFocus(index - 1, 'end');
				return true;
			}
			focusActions.moveFocus(index - 1, 'end');
			return true;
		}

		// Pair-delete: remove both halves so the auto-closed companion isn't stranded.
		// A caret inside a backtick fence run reads as a pair, so it declines there.
		const text = getDisplayText();
		const pairSpan = { start: offset - 1, end: offset + 1 };
		if (isBetweenEmptyPair(text, offset) && !crossesFenceBoundary(node, pairSpan)) {
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			pendingCursorOffset = commitDisplay(newText, offset, offset - 1);
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || backend.getRawSelection() !== null) return false;
		const offset = backend.getRaw() ?? 0;
		if (classifyFenceBoundary({ node, offset, forward: true }).kind === 'exitNext') {
			// The root's forward asymmetry (past-end appends a paragraph) would strand a
			// spurious block here, so suppress the append; no-op at the true doc end.
			focusActions.moveFocus(index + 1, 'start', { append: false });
			return true;
		}
		return false;
	}

	// The browser's insertParagraph adds <div>/<br> elements that don't affect
	// textContent, so the CST never sees the edit; Enter goes through the CST instead.
	function codeNewline(): boolean {
		if (!el) return false;
		// Read live: a command dispatched from another block arrives with no input event here.
		const offset = backend.getRaw() ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

		// Source mode paints the markers and never completes a bare fence on focus, so Enter is
		// where it happens there; the marker-hiding modes did it as the caret arrived.
		if (completeBareFence()) {
			if (infoString === '' && !readOnly && !languageOffered) {
				languageOffered = true;
				void tick().then(() => {
					autoOpenLanguage = true;
				});
			}
			return true;
		}

		const exit = computeFenceExit({ text, offset, meta });
		if (exit.kind === 'closeAndExit') {
			closeUnclosedFenceAndDescend(exit.newText);
			return true;
		}
		if (exit.kind !== 'none') {
			if (exit.kind === 'exitWithEdit') {
				commitDisplay(exit.newText, offset, offset);
			}
			exitDownward();
			return true;
		}

		// The undo anchor stays on the true pre-edit caret (`offset`); the splice
		// itself lands wherever the fence lines allow.
		const span = enterSpliceSpan(currentRange());

		// Electric indent: between an empty bracket pair, expand into three lines with an
		// extra indent on the middle. Quote pairs stay inline; a selection is replaced.
		const ending = blockEnding();
		if (span.start === span.end && isBetweenEmptyBracketPair(text, span.start)) {
			const at = span.start;
			const indent = getLineLeadingWhitespace(text, at);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, at) + ending + inner + ending + indent + text.slice(at);
			const innerCaret = at + ending.length + inner.length;
			pendingCursorOffset = commitDisplay(newText, offset, innerCaret);
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: span,
			mode: 'normal',
			ending
		});
		pendingCursorOffset = commitDisplay(enter.newText, offset, enter.newCursor);
		return true;
	}

	// Leaving a closed fence with Enter lands inside the fence's own container: the next
	// sibling, or a new paragraph made there. Without this a nested last child would hand
	// the caret outside its container.
	function exitDownward(): void {
		const container = myPath.length > 1 ? nodeAt(getDoc(), myPath.slice(0, -1)) : null;
		const isNestedLastChild = !!container?.children && index === container.children.length - 1;
		if (isNestedLastChild) blockEdit.descendToBody(index);
		else focusActions.moveFocus(index + 1, 'start');
	}

	// Leaving an unclosed fence downward writes its closer, which stops a save and reload from
	// absorbing the blocks below into it. Closer and new paragraph land as one commit.
	function closeUnclosedFenceAndDescend(closedDisplay: string): void {
		const meta = metadataOf(node, 'fencedCode');
		const lineEnding = blockEnding();
		const closedFence: CstNode = {
			kind: 'fencedCode',
			leadingTrivia: '',
			raw: closedDisplay + lineEnding,
			metadata: { ...meta, closed: true }
		};
		// The blank separator line and the paragraph's own line are both pure line
		// ending, so both take the one the closer above got.
		const paragraphBelow = emptyParagraph(lineEnding, lineEnding);
		void blockEdit.replaceBlock(index, [closedFence, paragraphBelow], {
			replacementIndex: 1,
			offset: 0
		});
	}

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		focusAtColumn,
		insertMarkdown,
		runCommand
	} satisfies BlockComponent);

	function currentRange(): { start: number; end: number } {
		if (!el) return { start: 0, end: 0 };
		const sel = backend.getRawSelection();
		if (sel) return sel;
		const cursor = backend.getRaw() ?? 0;
		return { start: cursor, end: cursor };
	}

	function applyIndentResult(result: IndentResult): void {
		const start = commitDisplay(result.text, result.selection.start, result.selection.start);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = start;
			return;
		}
		// Both endpoints sit inside the body, so an escalation inserting at the opener
		// run moves them by the same delta.
		const shift = start - result.selection.start;
		pendingSelection = { start, end: result.selection.end + shift };
	}

	// Both gestures rewrite whole lines, so their range clamps off the fence lines: the
	// multi-line counterpart of `codeNewline`'s `clampEnterOffsetToBody`. `el` is needed
	// only because `currentRange()` reads the DOM selection through it.
	function indentSelection(): void {
		if (!el) return;
		applyIndentResult(indentLines(getDisplayText(), clampRangeToBody(node, currentRange())));
	}

	function dedentSelection(): void {
		if (!el) return;
		const text = getDisplayText();
		const result = dedentLines(text, clampRangeToBody(node, currentRange()));
		if (result.text === text) return;
		applyIndentResult(result);
	}

	// ── Pointer + clipboard ─────────────────────────────────────────────

	function onPointerDown(e: PointerEvent): void {
		void crossBlock.handlePointerDown(e);
	}

	// Code has no marker prefix, so a selection of its DOM text is a slice of its raw: copy
	// falls back to the shared visible-selection default, and cut writes that before deleting.
	const clipboard = createClipboardHandlers({
		caretMemory,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: () => readOnly,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		// Copy is verbatim while the delete clamps: the clipboard keeps the literal bytes
		// selected, fence characters included, and only the body half is removed.
		cutTail: (e) => {
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			if (!el) return;
			const selOffsets = backend.getRawSelection();
			if (!selOffsets) return;
			const edit = computeFenceRangedEdit(node, selOffsets, '');
			if (!edit) return;
			pendingCursorOffset = commitDisplay(edit.newText, edit.newCursor, edit.newCursor);
		},
		pasteTail: async (pastedText) => {
			if (!el) return;
			// Paste refuses where typing refuses: a target confined to fence structure has
			// nothing to paste into. The tree-op owns the splice, so the span goes to it.
			const target = currentRange();
			if (isStructureOnlyRange(node, target)) return;
			const sel = fenceEditSpan(node, target);
			const result = await pasteDispatch(
				{
					pastedText,
					targetPath: myPath,
					offset: sel.start,
					preDelete: sel.start !== sel.end ? { start: sel.start, end: sel.end } : undefined
				},
				{
					doc: getDoc(),
					blockEdit,
					controller: pasteCoordinator,
					reading,
					activePlugins
				}
			);

			if (result.inlineCaretOffset !== undefined) {
				pendingCursorOffset = result.inlineCaretOffset;
			}
		}
	});
	const { onCopy, onCut, onPaste } = clipboard;

	export function insertMarkdown(md: string): Promise<boolean> {
		return clipboard.insertMarkdown(md);
	}
</script>

<!-- The textbox role arrives through the spread, where the compiler cannot see it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	{...editableSurfaceAttributes(node, null)}
	spellcheck="false"
	oninput={onInput}
	onfocus={onSurfaceFocus}
	onkeydown={onKeyDownTraced}
	onbeforeinput={editableSurface.onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>
<!-- Beside the walk container, never inside it: the render effect replaces that element's
	children on every commit, and the offset walk counts everything that survives there. -->
{#if showRail}
	<CodeBlockRail
		info={infoString}
		activation={activePlugins}
		editable={!readOnly}
		autoOpen={autoOpenLanguage}
		onCommit={commitLanguage}
		onCancel={(returnCaret) => returnCaret && returnCaretToBody()}
		onRun={onRunCode ? () => onRunCode(runRequest()) : undefined}
		onCopy={copyBody}
		menuItems={codeMenuItems ? () => codeMenuItems(runRequest()) : undefined}
		{menuPresence}
	/>
{/if}

<style>
	/* A recessed slab rather than an outlined field: the fill carries the block and the
	   border only closes its edge, so a page of prose reads code as a surface it sits on. */
	.code-block {
		width: 100%;
		outline: none;
		padding: 14px 16px;
		font-family: var(--font-code, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.55;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid transparent;
		border-radius: var(--radius-surface, 8px);
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		tab-size: 4;
		box-sizing: border-box;
		min-height: 1.4em;
		transition: border-color 120ms ease-out;
	}

	/* The caret is the primary focus signal inside the box; the border only warms, so a
	   click into code does not flash a heavy ring across the page. */
	/* Focus lives in the gutter's search field while the picker is open, outside this element,
	   so the block would otherwise drop its focused look mid-interaction. */
	.code-block:focus,
	.code-block:has(~ :global(.code-rail-open)) {
		border-color: var(--color-border, #3d4047);
	}

	@media (prefers-reduced-motion: reduce) {
		.code-block {
			transition: none;
		}
	}

	.code-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.65);
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #567b67);
		opacity: 0.7;
	}
</style>
