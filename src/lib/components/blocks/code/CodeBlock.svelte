<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../../../action-contracts';
	import { type BlockComponent, type StickyColumnDirection } from '../../../block-component';
	import type { NodeView } from '../../../core/node-views';
	import { emitCommandError } from '../../../editor-events';
	import {
		BLOCK_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../../editor-keys';
	import { asDomTextOffset, asRawOffset } from '../../../cursor/coordinate-spaces';
	import { CONTENT_EMPTY_ATTR, holdsOnlyMarkerChrome } from '../../../cursor/widget-offset';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getRangeOffsets as getRangeOffsetsHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../../cursor/content-offsets';
	import { handleSharedKeydown, handleSharedBeforeInput } from '../../../selection/shared-keydown';
	import {
		createEditableSurface,
		createClipboardHandlers,
		consumePendingRestore
	} from '../editable-surface';
	import { createContentOffsetBackend, anchorTrailingNewline } from '../plain-text-backend';
	import { parkFocusOnEditorRoot } from '../../../selection/native-bridge';
	import { renderCodeBlock } from './code-renderer';
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
	import CodeLanguageChip from './CodeLanguageChip.svelte';
	import { computeFenceExit } from './code-fence-exit';
	import {
		classifyFenceBoundary,
		clampCaretToBody,
		clampEnterOffsetToBody,
		clampRangeToBody,
		computeFenceRangedEdit,
		crossesFenceBoundary,
		fenceEditSpan,
		isStructureOnlyRange,
		type CodeRange
	} from './code-fence-boundary';
	import { metadataOf, type CstNode } from '../../../core/nodes';
	import { trimTrailingLineEnding, trailingLineEnding } from '../../../core/lines';
	import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
	import { nodeAt, emptyParagraph } from '../../../tree-operations';
	import { eventToChord } from '../../../schema/keybindings';
	import { type CommandId } from '../../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../../schema/block-commands';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

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
		presentationMode: getPresentationMode,
		onPasteImage
	} = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const {
		blockElLookup: getBlockElByPath,
		doc: getDoc,
		editorRoot: getEditorRoot,
		scrollHost: getScrollHost,
		lifetime: editorLifetime,
		pluginEditor,
		linkRef
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	const presentationMode = $derived(getPresentationMode?.() ?? 'source');
	const readOnly = $derived(presentationMode === 'reading');
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	// The walk container's own stamp, kept as state rather than re-derived: it is what
	// decides whether this block paints its fence chrome, and so whether it needs a chip.
	let contentEmpty = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	const { backend, getFocusOffset, getTextLen, readText } = createContentOffsetBackend(
		() => el ?? null
	);

	const editableSurface = createEditableSurface({
		linkRef,
		getEl: () => el ?? null,
		getAmbientLength: () => 0,
		backend,
		getMyPath: () => myPath,
		getIndex: () => index,
		getComposing: () => composing,
		setComposing: (value) => {
			composing = value;
		},
		getPreEditOffset: () => preEditOffset,
		setPreEditOffset: (offset) => {
			preEditOffset = offset;
		},
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
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
		readText,
		// Hands back the caret the RECONCILED bytes want: the write seam can grow the
		// fence or drop a character, either of which moves the caret off the DOM's.
		commitInput: (text, preEdit, savedOffset) => commitDisplay(text, preEdit, savedOffset)
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	// Every caret-landing door clamps onto editable content: a caret on a fence line
	// takes keystrokes the fence guard refuses, and a PARKED caret there is as dead as
	// a placed one, so both verbs clamp.
	export function focus(offset: number): void {
		editableSurface.surface.focus(clampCaretToBody(node, offset));
	}

	export function parkCaret(offset: number): void {
		editableSurface.surface.parkCaret(clampCaretToBody(node, offset));
	}

	// The column walk resolves against pixels, so it can only be corrected after the
	// fact: re-seat when it lands on a fence line, leave it alone when it doesn't.
	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		editableSurface.surface.focusAtColumn(x, from);
		const landed = backend.getRaw();
		if (landed === null) return;
		const seated = clampCaretToBody(node, landed);
		if (seated !== landed) backend.setRaw(asRawOffset(seated));
	}

	export const getCursorOffset = editableSurface.surface.getCursorOffset;
	export const getSelectedText = editableSurface.surface.getSelectedText;
	export const setSelection = editableSurface.surface.setSelection;
	export const measurePartialRects = editableSurface.surface.measurePartialRects;

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	/**
	 * The block's ONE display-commit door: no gesture calls `updateBlockContent` directly (pinned
	 * by `lint/code-commit-funnel`). The write seam sits inside rather than at each caller, so
	 * every gesture gets fence reconciliation by construction.
	 */
	function commitDisplay(display: string, undoAnchor: number, caret: number): number {
		const written = reconcileFenceWrite({
			display,
			caret,
			fence: fenceShapeOf(node),
			mode: 'authored'
		});
		void blockEdit.updateBlockContent(
			index,
			written.display + trailingLineEnding(node.raw),
			undoAnchor
		);
		return written.caret;
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		anchorTrailingNewline(el);
		const chromeOnly = holdsOnlyMarkerChrome(el);
		el.toggleAttribute(CONTENT_EMPTY_ATTR, chromeOnly);
		contentEmpty = chromeOnly;
		lastRenderedRaw = node.raw;

		// Restore only while this block still holds focus: an edit reparsing to multiple
		// blocks moves the caret to the split-off sibling, and a blur would otherwise yank
		// the global selection back. The pending fields clear regardless, never re-armed.
		if (pendingSelection !== null) {
			consumePendingRestore(el, pendingSelection, (range) => {
				const domRange = createRangeFromOffsets(
					el!,
					asDomTextOffset(range.start),
					asDomTextOffset(range.end)
				);
				if (!domRange) return;
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(domRange);
			});
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			consumePendingRestore(el, pendingCursorOffset, (offset) =>
				setCursorOffsetHelper(el!, asDomTextOffset(offset))
			);
			pendingCursorOffset = null;
		}
	});

	// Windowed out while focused: hand focus to the editor root so the next keystroke
	// routes through its document-level listener instead of falling to <body>.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

	// ── The language chip ─────────────────────────────────────────────────────

	// The chip stands in for fence chrome the mode paints nothing for, so it shows exactly
	// where that chrome is missing: never in source, never on a block painting its own.
	const showChip = $derived(hidesMarkers(presentationMode) && !contentEmpty);
	const infoString = $derived(metadataOf(node, 'fencedCode').info);

	// The chip's write: the opener's info span, through the display funnel so the fence rule
	// runs over it, isolated so no typing burst on either side joins its undo entry.
	function commitLanguage(info: string): void {
		const display = getDisplayText();
		const written = writeFenceInfo(display, info, fenceShapeOf(node));
		const bodyStart = clampCaretToBody(node, 0);
		// Unchanged or refused bytes are a close, not a write — no entry, no edit event.
		if (written !== null && written !== display) {
			controller.isolateUndoEntry(() => commitDisplay(written, bodyStart, bodyStart));
		}
		returnCaretToBody();
	}

	// This block's own door, not `moveFocus`: the chip is chrome over one block, and a
	// traversal to it stops at the gap above instead. The seat waits for the commit's render.
	function returnCaretToBody(): void {
		void tick().then(() => focus(0));
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	const onInput = editableSurface.onInput;
	const onCompositionEnd = editableSurface.onCompositionEnd;

	// An IME deletes the selection as it starts composing, and beforeinput's
	// insertCompositionText is not cancelable — so a fence-crossing selection shrinks
	// onto its body span here, before the composition owns the surface.
	function onCompositionStart(): void {
		const sel = el ? getSelectionOffsetsHelper(el) : null;
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
			// Mobile/IME paths skip onKeyDown so preEditOffset may be stale; capture fresh.
			const branchPreEditOffset = backend.getRaw() ?? 0;
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: enterSpliceSpan(currentRange()),
				mode: 'soft',
				ending: trailingLineEnding(node.raw)
			});
			pendingCursorOffset = commitDisplay(result.newText, branchPreEditOffset, result.newCursor);
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = selOffsets ? selOffsets.start : (backend.getRaw() ?? 0);

		const meta = metadataOf(node, 'fencedCode');
		const result = computeAutoPair({
			text,
			selection: selOffsets ?? { start: offset, end: offset },
			typed: data,
			unclosedBacktickFence: meta.closed === false && meta.fenceMarker === '`'
		});
		if (!result) return;

		e.preventDefault();
		if (result.kind === 'skip') {
			setCursorOffsetHelper(el, asDomTextOffset(result.caretOffset));
			return;
		}
		if (result.kind === 'wrap') {
			// Both endpoints sit inside the body, so whatever the seam inserts ahead of
			// the wrap's start moves its end by the same delta.
			const start = commitDisplay(result.newText, preEditOffset, result.selection.start);
			const shift = start - result.selection.start;
			pendingSelection = { start, end: result.selection.end + shift };
		} else {
			pendingCursorOffset = commitDisplay(result.newText, preEditOffset, result.caretOffset);
		}
	}

	// ── Fence-crossing edits ──────────────────────────────────────────────────

	/**
	 * Where an Enter-family splice lands (the `code.newline` command and the soft
	 * break): a caret clamps out of the fence lines, a selection is replaced on its
	 * body span like every other ranged edit here.
	 */
	function enterSpliceSpan(range: CodeRange): CodeRange {
		if (range.start !== range.end) return fenceEditSpan(node, range);
		const at = clampEnterOffsetToBody(node, range.start);
		return { start: at, end: at };
	}

	/**
	 * The one guard for every native edit that rewrites a range here — delete,
	 * forward-delete, type-over, word delete, drag. One that crosses a fence line is
	 * re-sited onto the body rather than left to splice the fence away.
	 */
	function guardFenceRangedEdit(e: InputEvent): boolean {
		if (composing || !el) return false;
		const range = pendingEditRange(e, el);
		if (!range || !crossesFenceBoundary(node, range)) return false;

		e.preventDefault();
		const insert = rangedEditInsertion(e, fenceEditSpan(node, range));
		if (insert === null) return true;
		const edit = computeFenceRangedEdit(node, range, insert);
		if (!edit) return true;
		// Mobile/IME beforeinput arrives without a preceding keydown, so the undo
		// anchor reads fresh rather than trusting preEditOffset (see the soft-break arm).
		pendingCursorOffset = commitDisplay(edit.newText, backend.getRaw() ?? 0, edit.newCursor);
		return true;
	}

	/**
	 * What the pending edit will rewrite. `getTargetRanges()` is the authority — a word
	 * delete at a collapsed caret reports the word, not the caret — and is
	 * feature-detected because jsdom does not implement it.
	 */
	function pendingEditRange(e: InputEvent, surface: HTMLElement): CodeRange | null {
		const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
		if (targets.length > 0) return getRangeOffsetsHelper(surface, targets[0]);
		const selected = getSelectionOffsetsHelper(surface);
		if (selected) return selected;
		const caret = backend.getRaw();
		return caret === null ? null : { start: caret, end: caret };
	}

	/**
	 * The text each claimed input type writes over its span: only a payload readable off the event
	 * or mintable here is re-sited, every other type is REFUSED (null: prevented, nothing
	 * committed). Text riding a `dataTransfer` would reach `parse()` without the paste transforms
	 * (G4.11).
	 */
	function rangedEditInsertion(e: InputEvent, span: CodeRange): string | null {
		if (e.inputType.startsWith('delete')) return '';
		switch (e.inputType) {
			case 'insertText':
				return e.data ?? '';
			case 'insertLineBreak':
				return trailingLineEnding(node.raw);
			// The keydown path auto-indents (computeCodeEnter 'normal'), and a mobile or
			// IME insertParagraph is the same gesture arriving without a keydown.
			case 'insertParagraph':
				return (
					trailingLineEnding(node.raw) + getLineLeadingWhitespace(getDisplayText(), span.start)
				);
			default:
				return null;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		preEditOffset = backend.getRaw() ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		const chord = eventToChord(e);
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: node.kind, runCommand },
				{ history, pluginEditor, getPresentationMode },
				keybindingOverrides(),
				onCommandError
			)
		) {
			e.preventDefault();
			return;
		}
	}

	// ── Commands ────────────────────────────────────────────────────────

	export function runCommand(id: CommandId): boolean {
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
			case 'block.moveUp':
				reorder.nudgeReorderUnit(myPath, -1);
				return true;
			case 'block.moveDown':
				reorder.nudgeReorderUnit(myPath, 1);
				return true;
			default:
				return false;
		}
	}

	function codeBackspace(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = backend.getRaw() ?? 0;
		// offset===0 is the universal contract; the classifyFenceBoundary check catches the
		// fence boundary, where a native Backspace would delete the opener's terminating `\n`.
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			focusActions.moveFocus(index - 1, 'end');
			return true;
		}

		// Pair-delete: remove both halves so the auto-closed companion isn't stranded.
		// A caret inside a backtick fence run reads as a pair, so it declines there.
		const text = getDisplayText();
		const pairSpan = { start: offset - 1, end: offset + 1 };
		if (isBetweenEmptyPair(text, offset) && !crossesFenceBoundary(node, pairSpan)) {
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			pendingCursorOffset = commitDisplay(newText, preEditOffset, offset - 1);
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || hasSelectionHelper()) return false;
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
	// textContent, so the CST never sees the edit — handle Enter via the CST path.
	function codeNewline(): boolean {
		if (!el) return false;
		// Read the caret live: cross-block dispatch calls runCommand without an
		// onKeyDown to refresh preEditOffset, so the undo anchor must read fresh.
		const offset = backend.getRaw() ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

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
		const ending = trailingLineEnding(node.raw);
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

	// A closed-fence Enter-exit lands within the fence's OWN container scope: the next
	// sibling, else a paragraph minted in-scope. Without this a nested last child would
	// delegate the caret outside its container.
	function exitDownward(): void {
		const container = myPath.length > 1 ? nodeAt(getDoc(), myPath.slice(0, -1)) : null;
		const isNestedLastChild = !!container?.children && index === container.children.length - 1;
		if (isNestedLastChild) blockEdit.descendToBody(index);
		else focusActions.moveFocus(index + 1, 'start');
	}

	// Leaving an unclosed fence downward mints its closer, keeping save→reload from lazy-absorbing
	// the trailing blocks into it. Closer and fresh paragraph land as ONE replaceBlock commit.
	function closeUnclosedFenceAndDescend(closedDisplay: string): void {
		const meta = metadataOf(node, 'fencedCode');
		const lineEnding = trailingLineEnding(node.raw);
		const closedFence: CstNode = {
			kind: 'fencedCode',
			leadingTrivia: '',
			raw: closedDisplay + lineEnding,
			metadata: { ...meta, closed: true }
		};
		// The blank separator line and the paragraph's own line are both pure line
		// ending, so both take the fence's (G4.20) — the same one the closer above got.
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
		runCommand
	} satisfies BlockComponent);

	function currentRange(): { start: number; end: number } {
		if (!el) return { start: 0, end: 0 };
		const sel = getSelectionOffsetsHelper(el);
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

	// Both gestures rewrite whole LINES, so their range clamps out of the fence lines —
	// the multi-line sibling of codeNewline's clampEnterOffsetToBody. `el` is required
	// only because currentRange() reads the DOM selection through it.
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
		if (crossBlock.handlePointerDown(e)) return;
	}

	// Code has no ambient markers, so its DOM-text selection IS its raw slice: copy falls
	// to the seam's visible-selection default, and cut writes that string before deleting.
	const { onCopy, onCut, onPaste } = createClipboardHandlers({
		stickyColumn,
		edgeAffinity,
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
			const selOffsets = getSelectionOffsetsHelper(el);
			if (!selOffsets) return;
			const edit = computeFenceRangedEdit(node, selOffsets, '');
			if (!edit) return;
			pendingCursorOffset = commitDisplay(edit.newText, edit.newCursor, edit.newCursor);
		},
		pasteTail: async (e, pastedText) => {
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
					controller: pasteCoordinator
				}
			);

			if (result.inlineCaretOffset !== undefined) {
				pendingCursorOffset = result.inlineCaretOffset;
			}
		}
	});
</script>

<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable={readOnly ? 'false' : 'true'}
	aria-readonly={readOnly ? 'true' : undefined}
	role="textbox"
	spellcheck="false"
	oninput={onInput}
	onkeydown={onKeyDown}
	onbeforeinput={onBeforeInput}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	oncompositionend={onCompositionEnd}
></div>
<!-- Beside the walk container, never inside it: the render effect replaces that element's
	children on every commit, and the offset walk counts everything that survives there. -->
{#if showChip}
	<CodeLanguageChip
		info={infoString}
		editable={!readOnly}
		onCommit={commitLanguage}
		onCancel={(returnCaret) => returnCaret && returnCaretToBody()}
	/>
{/if}

<style>
	.code-block {
		width: 100%;
		outline: none;
		padding: 12px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		line-height: 1.5;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		color: inherit;
		white-space: pre;
		overflow-x: auto;
		overflow-y: hidden;
		tab-size: 4;
		box-sizing: border-box;
		min-height: 1.4em;
	}

	.code-block:focus {
		border-color: var(--color-accent, #567b67);
	}

	.code-block :global(.md-marker) {
		opacity: var(--syntax-marker-dim, 0.65);
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #567b67);
		opacity: 0.7;
	}
</style>
