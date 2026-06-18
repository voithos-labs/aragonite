<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		HistoryActions
	} from '../../action-contracts';
	import { type BlockComponent, type StickyColumnDirection } from '../../block-component';
	import type { CstNode } from '../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		DOC_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		PASTE_COORDINATOR_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		type BlockElLookup,
		type DocumentGetter
	} from '../../editor-keys';
	import type { UndoController } from '../../editor-actions/deps';
	import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionFocusOffset as getSelectionFocusOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../cursor/content-offsets';
	import { findOffsetNearestX } from '../../cursor/sticky-measure';
	import { measurePartialRectsInContentEditable } from '../../cursor/overlay-rects';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../selection/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block/dispatch';
	import { writeCrossBlockCopy, writeCrossBlockCut } from '../../selection/cross-block/clipboard';
	import { renderCodeBlock } from './code/code-renderer';
	import {
		getLineLeadingWhitespace,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code/code-editing';
	import { indentLines, dedentLines, type IndentResult } from './code/code-indent';
	import { computeCodeEnter } from './code/code-enter';
	import { computeAutoPair } from './code/code-beforeinput';
	import { computeFenceExit } from './code/code-fence-exit';
	import { classifyFenceBoundary } from './code/code-fence-boundary';
	import { metadataOf } from '../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../core/lines';
	import { pasteDispatch } from '../../tree-operations/paste/dispatch';
	import { eventToChord } from '../../schema/keybindings';
	import { dispatchKeyCommand, type CommandId } from '../../schema/commands';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const pasteCoordinator = getContext<PasteCommitCoordinator>(PASTE_COORDINATOR_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
	const editorLifetime = getContext<AbortSignal | undefined>(EDITOR_LIFETIME_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

	const crossBlock = createCrossBlockHandlers({
		getEl: () => el ?? null,
		getMyPath: () => myPath,
		getIndex: () => index,
		selection,
		getDoc,
		getBlockElByPath,
		revealPath: focusActions.revealPath,
		getEditorRoot,
		getEditorLifetime: () => editorLifetime ?? null,
		stickyColumn,
		containerEdit,
		blockEdit,
		controller,
		history,
		pasteCoordinator,
		getCursorOffset: () => (el ? (getCursorOffsetHelper(el) ?? null) : null),
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => (el ? getCursorOffsetHelper(el) : null),
		getFocusOffset: () => (el ? getSelectionFocusOffsetHelper(el) : null),
		getTextLen: () => (el?.textContent ?? '').length,
		getMyPath: () => myPath,
		getIndex: () => index,
		crossBlock,
		selection,
		stickyColumn,
		history,
		focus: focusActions,
		getDoc,
		getBlockElByPath
	};

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!el) return;
		el.focus();
		setCursorOffsetHelper(el, Math.max(0, offset));
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!el) return;
		el.focus();
		const targetOffset = findOffsetNearestX(el, x, from);
		setCursorOffsetHelper(el, targetOffset);
	}

	export function getCursorOffset(): number | null {
		if (!el) return null;
		return getCursorOffsetHelper(el);
	}

	export function getSelectedText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	export function setSelection(start: number, end: number): void {
		if (!el) return;
		const range = createRangeFromOffsets(el, start, end);
		if (!range) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (!el) return [];
		return measurePartialRectsInContentEditable(el, startOffset, endOffset);
	}

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null)
			return;

		el.replaceChildren(renderCodeBlock(node));
		anchorTrailingNewlineForChromium(el);
		lastRenderedRaw = node.raw;

		if (pendingSelection !== null) {
			const range = createRangeFromOffsets(el, pendingSelection.start, pendingSelection.end);
			if (range) {
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
			pendingSelection = null;
			pendingCursorOffset = null;
		} else if (pendingCursorOffset !== null) {
			setCursorOffsetHelper(el, pendingCursorOffset);
			pendingCursorOffset = null;
		}
	});

	/**
	 * Chromium with `white-space: pre` won't paint a caret on the line after a
	 * trailing `\n` unless something follows it; typed text routes before the `\n`.
	 * A trailing `<br>` anchors the caret on the new line. BR has empty textContent,
	 * so `textContent === trimTrailingLineEnding(raw)` still holds.
	 * Re-applied every render — the renderer owns the contenteditable's children.
	 */
	function anchorTrailingNewlineForChromium(host: HTMLElement): void {
		if (!host.textContent?.endsWith('\n')) return;
		const br = document.createElement('br');
		br.dataset.caretAnchor = '';
		host.appendChild(br);
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (composing || !el) return;
		const text = el.textContent ?? '';
		const savedOffset = getCursorOffsetHelper(el) ?? 0;
		blockEdit.updateBlockContent(index, text + '\n', preEditOffset);
		pendingCursorOffset = savedOffset;
	}

	function onCompositionStart(): void {
		if (!el) return;
		// Capture before crossBlock.handleCompositionStart() — sync delete moves the caret.
		preEditOffset = getCursorOffsetHelper(el) ?? 0;
		crossBlock.handleCompositionStart();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		// Soft break path: Shift+Enter on desktop and mobile/IME insertLineBreak without a preceding keydown.
		if (e.inputType === 'insertLineBreak' && el) {
			e.preventDefault();
			// Mobile/IME paths skip onKeyDown so preEditOffset may be stale; capture fresh.
			const branchPreEditOffset = getCursorOffsetHelper(el) ?? 0;
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: currentRange(),
				mode: 'soft'
			});
			blockEdit.updateBlockContent(index, result.newText + '\n', branchPreEditOffset);
			pendingCursorOffset = result.newCursor;
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = selOffsets ? selOffsets.start : (getCursorOffsetHelper(el) ?? 0);

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
			setCursorOffsetHelper(el, result.caretOffset);
			return;
		}
		blockEdit.updateBlockContent(index, result.newText + '\n', preEditOffset);
		if (result.kind === 'wrap') {
			pendingSelection = result.selection;
		} else {
			pendingCursorOffset = result.caretOffset;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;
		if (!el) return;

		preEditOffset = getCursorOffsetHelper(el) ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		const chord = eventToChord(e);
		if (chord && dispatchKeyCommand(chord, { kind: node.kind, runCommand }, { history })) {
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
			default:
				return false;
		}
	}

	function codeBackspace(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = getCursorOffsetHelper(el) ?? 0;
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
		const text = getDisplayText();
		if (isBetweenEmptyPair(text, offset)) {
			const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
			blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
			pendingCursorOffset = offset - 1;
			return true;
		}
		return false;
	}

	function codeDelete(): boolean {
		if (!el || hasSelectionHelper()) return false;
		const offset = getCursorOffsetHelper(el) ?? 0;
		if (classifyFenceBoundary({ node, offset, forward: true }).kind === 'exitNext') {
			// Don't fall through to moveFocus's past-end behavior (which would
			// append a new paragraph). Delete at the closer boundary is a
			// focus-only move when a next block exists; a true no-op otherwise.
			if (index + 1 < getDoc().children.length) {
				focusActions.moveFocus(index + 1, 'start');
			}
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
		const offset = getCursorOffsetHelper(el) ?? 0;
		const text = getDisplayText();
		const meta = metadataOf(node, 'fencedCode');

		const exit = computeFenceExit({ text, offset, meta });
		if (exit.kind !== 'none') {
			if (exit.kind === 'exitWithEdit') {
				blockEdit.updateBlockContent(index, exit.newText + '\n', offset);
			}
			focusActions.moveFocus(index + 1, 'start');
			return true;
		}

		// Electric indent: between an empty bracket pair, expand into three lines
		// with an extra indent on the middle line. Quote pairs stay inline.
		if (isBetweenEmptyBracketPair(text, offset)) {
			const indent = getLineLeadingWhitespace(text, offset);
			const inner = indent + ELECTRIC_INDENT_UNIT;
			const newText = text.slice(0, offset) + '\n' + inner + '\n' + indent + text.slice(offset);
			blockEdit.updateBlockContent(index, newText + '\n', offset);
			pendingCursorOffset = offset + 1 + inner.length;
			return true;
		}

		const enter = computeCodeEnter({
			display: text,
			selection: { start: offset, end: offset },
			mode: 'normal'
		});
		blockEdit.updateBlockContent(index, enter.newText + '\n', offset);
		pendingCursorOffset = enter.newCursor;
		return true;
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusAtColumn,
		runCommand
	} satisfies BlockComponent);

	function currentRange(): { start: number; end: number } {
		if (!el) return { start: 0, end: 0 };
		const sel = getSelectionOffsetsHelper(el);
		if (sel) return sel;
		const cursor = getCursorOffsetHelper(el) ?? 0;
		return { start: cursor, end: cursor };
	}

	function applyIndentResult(result: IndentResult): void {
		blockEdit.updateBlockContent(index, result.text + '\n', result.selection.start);
		if (result.selection.start === result.selection.end) {
			pendingCursorOffset = result.selection.start;
		} else {
			pendingSelection = result.selection;
		}
	}

	function indentSelection(): void {
		if (!el) return;
		applyIndentResult(indentLines(el.textContent ?? '', currentRange()));
	}

	function dedentSelection(): void {
		if (!el) return;
		const text = el.textContent ?? '';
		const result = dedentLines(text, currentRange());
		if (result.text === text) return; // no-op: nothing to dedent
		applyIndentResult(result);
	}

	function onPointerDown(e: PointerEvent): void {
		if (crossBlock.handlePointerDown(e)) return;
	}

	function getCopyPayload(): string {
		return window.getSelection()?.toString() ?? '';
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		if (writeCrossBlockCopy(e, { selection, getDoc, crossBlock })) return;
		e.clipboardData?.setData('text/plain', getCopyPayload());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();
		if (await writeCrossBlockCut(e, { selection, getDoc, crossBlock })) return;
		e.clipboardData?.setData('text/plain', getCopyPayload());

		if (!el) return;
		const selOffsets = getSelectionOffsetsHelper(el);
		if (selOffsets) {
			const display = getDisplayText();
			const newDisplay = display.slice(0, selOffsets.start) + display.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, newDisplay + '\n', selOffsets.start);
			pendingCursorOffset = selOffsets.start;
		}
	}

	async function onPaste(e: ClipboardEvent): Promise<void> {
		if (await crossBlock.handlePaste(e)) return;

		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const pasted = normalizeLineEndings(e.clipboardData?.getData('text/plain') ?? '');
		if (!pasted) return;

		const sel = currentRange();
		const result = await pasteDispatch(
			{
				pastedText: pasted,
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
</script>

<div
	bind:this={el}
	tabindex="0"
	class="code-block"
	contenteditable="true"
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
		font-family: 'Fira Code', 'Consolas', monospace;
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
		opacity: 0.4;
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #567b67);
		opacity: 0.7;
	}
</style>
