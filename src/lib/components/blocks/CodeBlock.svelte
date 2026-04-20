<script lang="ts">
	import { getContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		type BlockEditActions,
		type BlockElLookup,
		type ContainerEditActions,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../contracts';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../contenteditable/cursor-utils';
	import { findOffsetNearestX } from '../../contenteditable/sticky-measure';
	import { measurePartialRectsInContentEditable } from '../../contenteditable/selection-measure';
	import {
		handleSharedKeydown,
		handleSharedBeforeInput,
		type SharedKeydownContext
	} from '../../contenteditable/shared-keydown';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import { createCrossBlockHandlers } from '../../selection/cross-block-dispatch';
	import { collectCrossBlockText } from '../../selection/clipboard-text';
	import { renderCodeBlock } from './code/code-renderer';
	import {
		getLineLeadingWhitespace,
		getCloserFor,
		shouldAutoClose,
		shouldSkipClose,
		isBetweenEmptyPair,
		isBetweenEmptyBracketPair
	} from './code/code-editing';
	import { indentLines, dedentLines, type IndentResult } from './code/code-indent';
	import { computeCodeEnter } from './code/code-enter';
	import type { FencedCodeMetadata } from '../../core/nodes';
	import { trimTrailingLineEnding, normalizeLineEndings } from '../../core/lines';
	import { pasteDispatch } from '../../tree-operations/paste-dispatch';

	const ELECTRIC_INDENT_UNIT = '\t';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const containerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);
	const getBlockElByPath = getContext<BlockElLookup>(BLOCK_EL_LOOKUP_KEY);
	const getDoc = getContext<DocumentGetter>(DOC_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);
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
		getEditorRoot,
		stickyColumn,
		containerEdit,
		blockEdit,
		getCursorOffset: () => getCursorOffsetHelper(el!) ?? null,
		afterReactivity: () => tick(),
		setPendingCursor: (offset) => {
			pendingCursorOffset = offset;
		}
	});

	const sharedCtx: SharedKeydownContext = {
		getEl: () => el ?? null,
		getCursorOffset: () => (el ? getCursorOffsetHelper(el) : null),
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

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

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
	 * Chromium with `white-space: pre` will not paint a caret on the line
	 * after a trailing `\n` unless something follows it — and `insertText` at
	 * that caret position routes the typed character BEFORE the `\n` instead
	 * (the bug that originally forced a DOM-mutation Enter handler). A
	 * `<br data-caret-anchor>` after the trailing newline gives the browser a
	 * concrete line-break anchor: the caret holds on the new line and typed
	 * text lands after the `\n` as expected. BR has empty textContent so the
	 * `textContent === trimTrailingLineEnding(raw)` invariant still holds.
	 * Re-added on every render because the renderer is the source of truth
	 * for the contenteditable's children.
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
		crossBlock.handleCompositionStart();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	async function onBeforeInput(e: InputEvent): Promise<void> {
		if (await handleSharedBeforeInput(e, sharedCtx)) return;
		// Shift+Enter on desktop — and the mobile/IME `insertLineBreak`
		// without a preceding keydown — both arrive here. Insert a bare `\n`
		// at the cursor and route through the CST so the source of truth
		// stays single (this is the "soft break" mode of `computeCodeEnter`).
		if (e.inputType === 'insertLineBreak' && el) {
			e.preventDefault();
			const result = computeCodeEnter({
				display: getDisplayText(),
				selection: currentRange(),
				mode: 'soft'
			});
			blockEdit.updateBlockContent(index, result.newText + '\n', preEditOffset);
			pendingCursorOffset = result.newCursor;
			return;
		}
		if (composing || e.inputType !== 'insertText' || !el) return;
		const data = e.data;
		if (!data || data.length !== 1) return;

		const text = getDisplayText();
		const selOffsets = getSelectionOffsetsHelper(el);
		const offset = getCursorOffsetHelper(el) ?? 0;

		const closer = getCloserFor(data);

		// Wrap a non-empty selection in a typed opener's pair. The selection
		// is preserved inside the pair so the user can keep typing to replace
		// the wrapped content.
		if (selOffsets && closer !== null) {
			e.preventDefault();
			const wrapped =
				text.slice(0, selOffsets.start) +
				data +
				text.slice(selOffsets.start, selOffsets.end) +
				closer +
				text.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, wrapped + '\n', preEditOffset);
			pendingSelection = { start: selOffsets.start + 1, end: selOffsets.end + 1 };
			return;
		}

		if (selOffsets) return; // Non-opener input with a selection — let the browser handle it.

		// Skip-over: typed closer already sits at the cursor. Move past it
		// without inserting a duplicate — the CST does not change, so we
		// bypass the render cycle and just advance the caret.
		if (shouldSkipClose(text, offset, data)) {
			e.preventDefault();
			setCursorOffsetHelper(el, offset + 1);
			return;
		}

		// Auto-pair: typed opener with a collapsed cursor inserts the closer too.
		// Skip backtick pairing in an unclosed backtick fence — the user is
		// almost certainly trying to close or extend the opening fence, not
		// type literal backticks. Auto-pairing there produces a phantom closer.
		const unclosedBacktickFence =
			data === '`' &&
			(node.metadata as FencedCodeMetadata).closed === false &&
			(node.metadata as FencedCodeMetadata).fenceMarker === '`';
		if (closer !== null && !unclosedBacktickFence && shouldAutoClose(text, offset, data)) {
			e.preventDefault();
			const newText = text.slice(0, offset) + data + closer + text.slice(offset);
			blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
			pendingCursorOffset = offset + 1;
			return;
		}
	}

	async function onKeyDown(e: KeyboardEvent): Promise<void> {
		if (composing) return;

		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		if (await handleSharedKeydown(e, sharedCtx)) return;

		// Ctrl+B / Ctrl+I — swallow inside code so the browser doesn't toggle
		// bold/italic on the contenteditable. Code blocks have no formatting.
		if (
			(e.ctrlKey || e.metaKey) &&
			(e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')
		) {
			e.preventDefault();
			return;
		}

		if (e.key === 'Backspace') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (offset === 0 && !hasSelectionHelper()) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}

			// Pair-delete: cursor sitting between a matching empty pair removes
			// both halves so the auto-closed companion does not get stranded.
			if (!hasSelectionHelper()) {
				const text = getDisplayText();
				if (isBetweenEmptyPair(text, offset)) {
					e.preventDefault();
					const newText = text.slice(0, offset - 1) + text.slice(offset + 1);
					blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
					pendingCursorOffset = offset - 1;
					return;
				}
			}
		}

		// Plain Enter: always handle manually. The browser's default `insertParagraph`
		// adds <div>/<br> elements that contribute zero characters to textContent,
		// which leaves the CST unchanged and the $effect wipes the browser's insertion
		// on re-render — making Enter appear to do nothing.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const text = getDisplayText();
			const meta = node.metadata as FencedCodeMetadata;

			if (meta.closed) {
				const fenceChars = meta.fenceMarker.repeat(meta.fenceLength);

				// Cursor past the closer (e.g. from Ctrl+End) → exit immediately.
				if (offset === text.length) {
					focusActions.moveFocus(index + 1, 'start');
					return;
				}

				// Cursor on an empty body line immediately before the closer → exit,
				// stripping the empty line so the block doesn't gain a trailing blank.
				const onEmptyLineBeforeCloser =
					offset >= 1 &&
					text[offset - 1] === '\n' &&
					text[offset] === '\n' &&
					text.slice(offset + 1, offset + 1 + fenceChars.length) === fenceChars;
				if (onEmptyLineBeforeCloser) {
					const newText = text.slice(0, offset) + text.slice(offset + 1);
					blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
					focusActions.moveFocus(index + 1, 'start');
					return;
				}
			} else {
				// Unclosed fence: exit when cursor is at the end of content AND the
				// content already ends with a blank line (the earlier Enter added it).
				if (offset === text.length && text.endsWith('\n')) {
					blockEdit.updateBlockContent(index, text.slice(0, -1) + '\n', preEditOffset);
					focusActions.moveFocus(index + 1, 'start');
					return;
				}
			}

			// Default: insert a newline at the cursor, copying the current line's
			// leading whitespace. When the cursor sits between an empty bracket
			// pair, expand into three lines with one extra indent level on the
			// middle line — the "electric indent" pattern every modern code
			// editor ships. Quote pairs stay inline.
			if (isBetweenEmptyBracketPair(text, offset)) {
				const indent = getLineLeadingWhitespace(text, offset);
				const inner = indent + ELECTRIC_INDENT_UNIT;
				const newText = text.slice(0, offset) + '\n' + inner + '\n' + indent + text.slice(offset);
				blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
				pendingCursorOffset = offset + 1 + inner.length;
				return;
			}

			const enter = computeCodeEnter({
				display: text,
				selection: { start: offset, end: offset },
				mode: 'normal'
			});
			blockEdit.updateBlockContent(index, enter.newText + '\n', preEditOffset);
			pendingCursorOffset = enter.newCursor;
			return;
		}

		if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				dedentSelection();
			} else {
				indentSelection();
			}
			return;
		}
	}

	/** Collapse the contenteditable's current selection to a `{start,end}` range. */
	function currentRange(): { start: number; end: number } {
		const sel = getSelectionOffsetsHelper(el!);
		if (sel) return sel;
		const cursor = getCursorOffsetHelper(el!) ?? 0;
		return { start: cursor, end: cursor };
	}

	/** Flush an IndentResult through the CST + cursor-restore pipeline. */
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

	/**
	 * Copy pulls the native selection verbatim — fences and all. The concern
	 * that a lone fence on the clipboard makes pasting into a paragraph create
	 * an unclosed code block is real, but the fix lives on the paste side:
	 * when the target is a code block, the code paste surface bumps the outer
	 * fence to a longer run so any pasted fence stays literal body. Pasting
	 * into a paragraph matches whatever the user selected, including orphan
	 * fences — the trade-off accepted when we chose "clipboard is literal"
	 * over silent content dropping.
	 */
	function getCopyPayload(): string {
		return window.getSelection()?.toString() ?? '';
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		if (selection.isCrossBlock && selection.anchor && selection.focus) {
			e.clipboardData?.setData(
				'text/plain',
				collectCrossBlockText(getDoc(), selection.anchor, selection.focus)
			);
			return;
		}
		e.clipboardData?.setData('text/plain', getCopyPayload());
	}

	async function onCut(e: ClipboardEvent): Promise<void> {
		stickyColumn.reset();
		e.preventDefault();
		if (selection.isCrossBlock && selection.anchor && selection.focus) {
			e.clipboardData?.setData(
				'text/plain',
				collectCrossBlockText(getDoc(), selection.anchor, selection.focus)
			);
			await crossBlock.performCrossBlockDeleteFromEvent();
			return;
		}
		e.clipboardData?.setData('text/plain', getCopyPayload());

		const selOffsets = getSelectionOffsetsHelper(el!);
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
				blockEdit
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
		border: 1px solid var(--color-ui-muted, rgba(128, 128, 128, 0.25));
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
		border-color: var(--color-accent, #4a9eff);
	}

	.code-block :global(.md-marker) {
		opacity: 0.4;
	}

	.code-block :global(.md-marker.md-lang) {
		color: var(--color-accent, #4a9eff);
		opacity: 0.7;
	}
</style>
