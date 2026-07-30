<script lang="ts">
	import { getContext } from 'svelte';
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
		pluginEditor
	} = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	const readOnly = $derived(getPresentationMode?.() === 'reading');
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	const { backend, getFocusOffset, getTextLen, readText } = createContentOffsetBackend(
		() => el ?? null
	);

	const editableSurface = createEditableSurface({
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
		// Code anchors undo at preEditOffset only; it has no kind-change remount to
		// re-focus, so it passes no saved offset (the omitted 4th argument).
		commitInput: (text, preEdit) => {
			void blockEdit.updateBlockContent(index, text + trailingLineEnding(node.raw), preEdit);
		}
	});

	const crossBlock = editableSurface.crossBlock;
	const sharedCtx = editableSurface.sharedCtx;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	// Every caret-landing door clamps onto editable content; every other surface
	// method is the shared implementation verbatim. Seating a caret on a fence line
	// hands the user a position whose keystrokes the fence guard refuses — the merge
	// fallback that moves focus to this block's END lands exactly there — and a
	// PARKED caret on a fence line is as dead as a placed one, so both verbs clamp.
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

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		anchorTrailingNewline(el);
		lastRenderedRaw = node.raw;

		// Restore only while this block still holds focus: an edit that reparses to
		// multiple blocks moves the caret to the split-off sibling (structural commit's
		// afterTick), and a blur would otherwise yank the global selection back. Two
		// arms — a wrap restores a range, a caret a point — and the pending fields clear
		// regardless so a skipped restore is dropped, never re-armed.
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

	// Windowed out while focused: hand focus to the editor root so the next
	// keystroke routes through its document-level listener instead of falling to
	// <body>. See parkFocusOnEditorRoot.
	$effect(() => {
		const blockEl = el;
		return () => parkFocusOnEditorRoot(blockEl ?? null, getEditorRoot());
	});

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
		// Soft break path: Shift+Enter on desktop and mobile/IME insertLineBreak
		// without a preceding keydown. Gated on !composing like the insertText arm
		// below: an IME emitting insertLineBreak mid-composition must not sync
		// (its mobile-Enter purpose applies post-compositionend, composing false).
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
			blockEdit.updateBlockContent(
				index,
				result.newText + trailingLineEnding(node.raw),
				branchPreEditOffset
			);
			pendingCursorOffset = result.newCursor;
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
		blockEdit.updateBlockContent(
			index,
			result.newText + trailingLineEnding(node.raw),
			preEditOffset
		);
		if (result.kind === 'wrap') {
			pendingSelection = result.selection;
		} else {
			pendingCursorOffset = result.caretOffset;
		}
	}

	// ── Fence-crossing edits ──────────────────────────────────────────────────

	/**
	 * Where an Enter-family splice lands, for both members (the `code.newline`
	 * command and the soft break). A caret clamps out of the two fence lines; a
	 * selection is replaced on its body span, like every other ranged edit here.
	 */
	function enterSpliceSpan(range: CodeRange): CodeRange {
		if (range.start !== range.end) return fenceEditSpan(node, range);
		const at = clampEnterOffsetToBody(node, range.start);
		return { start: at, end: at };
	}

	/**
	 * The one guard for every native edit that rewrites a range on this surface.
	 * The block's own gestures (`codeBackspace`, `codeDelete`, Tab) each cover a
	 * collapsed caret or a whole line; a delete, forward-delete, type-over, word
	 * delete or drag arrives here instead, and one that crosses a fence line is
	 * re-sited onto the body rather than left to splice the fence away. Claims the
	 * event when it acted.
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
		blockEdit.updateBlockContent(
			index,
			edit.newText + trailingLineEnding(node.raw),
			backend.getRaw() ?? 0
		);
		pendingCursorOffset = edit.newCursor;
		return true;
	}

	/**
	 * What the pending edit will rewrite. `getTargetRanges()` is the authority — a
	 * word delete at a collapsed caret reports the word, not the caret — and it is
	 * feature-detected because jsdom does not implement it; the live selection is
	 * the fallback every path can answer.
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
	 * The text each claimed input type writes over its span — the grep target for
	 * "which gestures does the fence guard re-site". The posture, not a list of
	 * exceptions: this surface re-sites only a payload it can read off the event
	 * itself or mint itself, and REFUSES (null: prevented, nothing committed) every
	 * other type. That covers the drop pair (`insertFromDrop` is answered by a
	 * `deleteByDrag` on the source range, and re-siting one half loses text), the
	 * replacement whose text rides a `dataTransfer`, and anything unknown or new.
	 * Refusing is also what keeps this surface off the clipboard→parse ladder: text
	 * pulled from a `dataTransfer` would reach `parse()` without the plugin paste
	 * transforms every sanctioned paste route runs (G4.11).
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
				return true; // code blocks don't format-toggle; swallow to stop the browser default
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
		// offset===0 is the universal contract; offset===bodyStart catches the
		// fence-boundary case (Home from the body lands there, and native
		// Backspace would delete the opener's terminating `\n`).
		if (
			offset === 0 ||
			classifyFenceBoundary({ node, offset, forward: false }).kind === 'exitPrev'
		) {
			focusActions.moveFocus(index - 1, 'end');
			return true;
		}

		// Pair-delete: remove both halves so the auto-closed companion isn't stranded.
		// Backticks are a pair, so a caret inside a fence run reads as one — declining
		// there drops to the native delete, which the beforeinput guard refuses.
		const text = getDisplayText();
		const pairSpan = { start: offset - 1, end: offset + 1 };
		if (isBetweenEmptyPair(text, offset) && !crossesFenceBoundary(node, pairSpan)) {
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			blockEdit.updateBlockContent(index, newText + trailingLineEnding(node.raw), preEditOffset);
			pendingCursorOffset = offset - 1;
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = backend.getRaw() ?? 0;
		if (classifyFenceBoundary({ node, offset, forward: true }).kind === 'exitNext') {
			// Mirror of codeBackspace's unconditional moveFocus(index - 1), but the
			// root's forward asymmetry (past-end appends a paragraph) would strand a
			// spurious block here. Suppress the append: focus the next block if one
			// exists (sibling or via upward delegation), no-op at the true doc end.
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
				blockEdit.updateBlockContent(index, exit.newText + trailingLineEnding(node.raw), offset);
			}
			exitDownward();
			return true;
		}

		// The undo anchor stays on the true pre-edit caret (`offset`); the splice
		// itself lands wherever the fence lines allow.
		const span = enterSpliceSpan(currentRange());

		// Electric indent: between an empty bracket pair, expand into three lines
		// with an extra indent on the middle line. Quote pairs stay inline. A
		// selection has no pair to sit between — it is replaced, not expanded.
		const ending = trailingLineEnding(node.raw);
		if (span.start === span.end && isBetweenEmptyBracketPair(text, span.start)) {
			const at = span.start;
			const indent = getLineLeadingWhitespace(text, at);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, at) + ending + inner + ending + indent + text.slice(at);
			blockEdit.updateBlockContent(index, newText + ending, offset);
			pendingCursorOffset = at + ending.length + inner.length;
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: span,
			mode: 'normal',
			ending
		});
		blockEdit.updateBlockContent(index, enter.newText + ending, offset);
		pendingCursorOffset = enter.newCursor;
		return true;
	}

	// A closed-fence Enter-exit lands on the block below within the fence's OWN
	// container scope: the next sibling when one exists, else a paragraph minted
	// in-scope. Only a nested last child would otherwise delegate the caret outside
	// its container — unifying that case with the unclosed auto-close and the
	// whole-block Enter tier. Root append and next-sibling landings are already
	// in-scope, so they ride the shared moveFocus path unchanged. descendToBody is
	// the choke point that mints-or-focuses-next against the live container children.
	function exitDownward(): void {
		const container = myPath.length > 1 ? nodeAt(getDoc(), myPath.slice(0, -1)) : null;
		const isNestedLastChild = !!container?.children && index === container.children.length - 1;
		if (isNestedLastChild) blockEdit.descendToBody(index);
		else focusActions.moveFocus(index + 1, 'start');
	}

	// Auto-close on structural escape: leaving an unclosed fence downward to author
	// a block below mints the fence's own closer into the code node's raw, so
	// save→reload no longer lazy-absorbs the trailing blocks into the open fence.
	// The closer write and the fresh paragraph land as ONE replaceBlock commit — a
	// single undo restores the open fence and drops the paragraph together.
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
		blockEdit.updateBlockContent(
			index,
			result.text + trailingLineEnding(node.raw),
			result.selection.start
		);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = result.selection.start;
		} else {
			pendingSelection = result.selection;
		}
	}

	// Both gestures rewrite whole LINES, so their range clamps out of the fence
	// lines — the multi-line sibling of codeNewline's clampEnterOffsetToBody.
	//
	// The text comes from the node; `el` is still required because currentRange()
	// reads the DOM selection through it.
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

	// Code has no ambient markers, so its DOM-text selection IS its raw slice: the
	// intra-block copy falls to the seam's visible-selection default (copyTail
	// omitted), and cut writes that same string before truncating.
	const { onCopy, onCut, onPaste } = createClipboardHandlers({
		stickyColumn,
		selection,
		getDoc,
		crossBlock,
		isReadOnly: () => readOnly,
		caret: editableSurface.caret,
		events: editorEvents,
		onPasteImage,
		// Copy is verbatim while the delete clamps: the clipboard keeps the literal
		// bytes the user selected, fence characters included, and only the body half
		// of that selection is removed.
		cutTail: (e) => {
			e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
			if (!el) return;
			const selOffsets = getSelectionOffsetsHelper(el);
			if (!selOffsets) return;
			const edit = computeFenceRangedEdit(node, selOffsets, '');
			if (!edit) return;
			blockEdit.updateBlockContent(
				index,
				edit.newText + trailingLineEnding(node.raw),
				edit.newCursor
			);
			pendingCursorOffset = edit.newCursor;
		},
		pasteTail: async (e, pastedText) => {
			if (!el) return;
			// Paste writes text like typing does, so it refuses where typing refuses: a
			// target confined to fence structure has nothing to paste into. Only the
			// clamp differs — the tree-op owns the splice, so the span goes to it.
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
