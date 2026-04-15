<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		STICKY_COLUMN_KEY,
		type BlockEditActions,
		type FocusActions,
		type HistoryActions,
		type CstNode,
		type BlockComponent,
		type StickyColumnDirection
	} from '../../editor-types';
	import { PRESERVE_KEYS_NON_ARROW, type StickyColumnState } from '../../sticky-column';
	import {
		createRangeFromOffsets,
		setCursorOffset as setCursorOffsetHelper,
		getCursorOffset as getCursorOffsetHelper,
		getSelectionOffsets as getSelectionOffsetsHelper,
		hasSelection as hasSelectionHelper
	} from '../../text-surface/cursor-utils';
	import {
		isAtFirstVisualLine,
		isAtLastVisualLine
	} from '../../text-surface/visual-lines';
	import {
		getCurrentCursorEditorRelativeX,
		findOffsetNearestX
	} from '../../text-surface/sticky-measure';
	import { renderCodeBlock, scanLongestFenceRun } from '../../code-surface/code-renderer';
	import type { FencedCodeMetadata } from '../../core/nodes';
	import { trimTrailingLineEnding } from '../../raw-text';

	let { node, index }: { node: CstNode; index: number } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	let el: HTMLDivElement | undefined = $state();
	let composing = $state(false);
	let pendingCursorOffset = $state<number | null>(null);
	let pendingSelection = $state<{ start: number; end: number } | null>(null);
	let lastRenderedRaw = '';
	let preEditOffset = 0;

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

	void ({ editable, focusable, focus, getCursorOffset, focusAtColumn } satisfies BlockComponent);

	// ── Render pipeline ───────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		if (!el) return;
		if (node.raw === lastRenderedRaw && pendingCursorOffset === null && pendingSelection === null) return;

		el.replaceChildren(renderCodeBlock(node));
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
		stickyColumn.reset();
		composing = true;
	}

	function onCompositionEnd(): void {
		composing = false;
		onInput();
	}

	function onBeforeInput(e: InputEvent): void {
		if (e.inputType === 'historyUndo') {
			e.preventDefault();
			history.requestUndo();
		} else if (e.inputType === 'historyRedo') {
			e.preventDefault();
			history.requestRedo();
		} else if (e.inputType === 'insertLineBreak') {
			// Shift+Enter: insert a literal \n text node rather than letting the
			// browser produce a <br> or <div>. A text node keeps el.textContent
			// well-formed so onInput → updateBlockContent sees a flat string.
			e.preventDefault();
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !el) return;
			const range = sel.getRangeAt(0);
			range.deleteContents();
			const newline = document.createTextNode('\n');
			range.insertNode(newline);
			range.setStartAfter(newline);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
			onInput();
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (composing) return;

		preEditOffset = getCursorOffsetHelper(el!) ?? 0;

		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			const x = getCurrentCursorEditorRelativeX(el!);
			if (x !== null) stickyColumn.capture(x);
		} else if (!PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
			stickyColumn.reset();
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
			e.preventDefault();
			return;
		}

		// Ctrl+Z / Ctrl+Y — catch here because Ctrl+Y doesn't fire beforeinput
		// historyRedo in Chromium/WebView2.
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			history.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			history.requestRedo();
			return;
		}

		if (e.key === 'Backspace') {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (offset === 0 && !hasSelectionHelper()) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
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

			// Default: insert a newline at the cursor.
			const newText = text.slice(0, offset) + '\n' + text.slice(offset);
			blockEdit.updateBlockContent(index, newText + '\n', preEditOffset);
			pendingCursorOffset = offset + 1;
			return;
		}

		if (e.key === 'ArrowUp' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			if (isAtFirstVisualLine(el!, offset)) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
				return;
			}
		}

		if (e.key === 'ArrowDown' && !e.shiftKey) {
			const offset = getCursorOffsetHelper(el!) ?? 0;
			const textLen = (el?.textContent ?? '').length;
			if (isAtLastVisualLine(el!, offset, textLen)) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
				return;
			}
		}

		if (e.key === 'ArrowLeft' && !e.shiftKey && el) {
			const offset = getCursorOffsetHelper(el);
			if (offset === 0) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if (e.key === 'ArrowRight' && !e.shiftKey && el) {
			const textLen = (el.textContent ?? '').length;
			const offset = getCursorOffsetHelper(el);
			if (offset === textLen) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
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

	function indentSelection(): void {
		if (!el) return;

		const offsets = getSelectionOffsetsHelper(el);

		if (!offsets) {
			const ok = document.execCommand('insertText', false, '\t');
			if (ok) return;
			// Fallback: manual Text-node insert + onInput flush
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return;
			const range = sel.getRangeAt(0);
			range.deleteContents();
			const tn = document.createTextNode('\t');
			range.insertNode(tn);
			range.setStartAfter(tn);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
			const text = el.textContent ?? '';
			const savedOffset = getCursorOffsetHelper(el) ?? 0;
			blockEdit.updateBlockContent(index, text + '\n', savedOffset);
			pendingCursorOffset = savedOffset;
			return;
		}

		// Multi-line selection — insert \t at every line start the selection touches
		const display = el.textContent ?? '';
		const lineStarts: number[] = [];
		const firstLineStart = display.lastIndexOf('\n', offsets.start - 1) + 1;
		lineStarts.push(firstLineStart);
		let pos = firstLineStart;
		while (pos < offsets.end) {
			const next = display.indexOf('\n', pos);
			if (next === -1 || next >= offsets.end) break;
			lineStarts.push(next + 1);
			pos = next + 1;
		}

		// Right-to-left to avoid offset drift during mutation
		let newText = display;
		for (let i = lineStarts.length - 1; i >= 0; i--) {
			const idx = lineStarts[i];
			newText = newText.slice(0, idx) + '\t' + newText.slice(idx);
		}

		const newStart = offsets.start + 1;
		const newEnd = offsets.end + lineStarts.length;

		blockEdit.updateBlockContent(index, newText + '\n', newStart);
		pendingSelection = { start: newStart, end: newEnd };
	}

	/** Returns 1 for leading `\t`, up to 4 for leading spaces, 0 otherwise. */
	function computeDedentCount(text: string, lineStart: number): number {
		if (text[lineStart] === '\t') return 1;
		let spaces = 0;
		while (spaces < 4 && text[lineStart + spaces] === ' ') spaces++;
		return spaces;
	}

	function dedentSelection(): void {
		if (!el) return;

		const offsets = getSelectionOffsetsHelper(el);
		const cursorOffset = getCursorOffsetHelper(el) ?? 0;

		if (!offsets) {
			const display = el.textContent ?? '';
			const lineStart = display.lastIndexOf('\n', cursorOffset - 1) + 1;
			const removed = computeDedentCount(display, lineStart);
			if (removed === 0) return;
			const newText = display.slice(0, lineStart) + display.slice(lineStart + removed);
			const newCursor = Math.max(lineStart, cursorOffset - removed);
			blockEdit.updateBlockContent(index, newText + '\n', newCursor);
			pendingCursorOffset = newCursor;
			return;
		}

		// Multi-line selection: dedent every line the selection touches
		const display = el.textContent ?? '';
		const lineStarts: number[] = [];
		const firstLineStart = display.lastIndexOf('\n', offsets.start - 1) + 1;
		lineStarts.push(firstLineStart);
		let pos = firstLineStart;
		while (pos < offsets.end) {
			const next = display.indexOf('\n', pos);
			if (next === -1 || next >= offsets.end) break;
			lineStarts.push(next + 1);
			pos = next + 1;
		}

		// Right-to-left to avoid offset drift during mutation
		let newText = display;
		let removedBeforeStart = 0;
		let removedWithin = 0;
		let removedOnFirstLine = 0;
		for (let i = lineStarts.length - 1; i >= 0; i--) {
			const idx = lineStarts[i];
			const removed = computeDedentCount(newText, idx);
			if (removed === 0) continue;
			newText = newText.slice(0, idx) + newText.slice(idx + removed);
			if (i === 0) removedOnFirstLine = removed;
			if (idx < offsets.start) removedBeforeStart += removed;
			else removedWithin += removed;
		}

		const newStart = Math.max(firstLineStart, offsets.start - removedOnFirstLine);
		const newEnd = offsets.end - (removedBeforeStart + removedWithin);

		blockEdit.updateBlockContent(index, newText + '\n', newStart);
		pendingSelection = { start: newStart, end: newEnd };
	}

	function onPointerDown(_e: PointerEvent): void {
		stickyColumn.reset();
	}

	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		e.clipboardData?.setData('text/plain', window.getSelection()?.toString() ?? '');
	}

	function onCut(e: ClipboardEvent): void {
		stickyColumn.reset();
		e.preventDefault();
		const selected = window.getSelection()?.toString() ?? '';
		e.clipboardData?.setData('text/plain', selected);

		const selOffsets = getSelectionOffsetsHelper(el!);
		if (selOffsets) {
			const display = getDisplayText();
			const newDisplay = display.slice(0, selOffsets.start) + display.slice(selOffsets.end);
			blockEdit.updateBlockContent(index, newDisplay + '\n', selOffsets.start);
			pendingCursorOffset = selOffsets.start;
		}
	}

	function onPaste(e: ClipboardEvent): void {
		stickyColumn.reset();
		if (!el) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const offsets = getSelectionOffsetsHelper(el);
		const cursorOffset = getCursorOffsetHelper(el) ?? 0;
		const start = offsets?.start ?? cursorOffset;
		const end = offsets?.end ?? cursorOffset;

		const meta = node.metadata as FencedCodeMetadata;
		const currentFenceLen = meta.fenceLength;
		const maxRunInPaste = scanLongestFenceRun(text, meta.fenceMarker);
		const needsBump = maxRunInPaste >= currentFenceLen;

		if (!needsBump) {
			const display = el.textContent ?? '';
			const newDisplay = display.slice(0, start) + text + display.slice(end);
			const newCursor = start + text.length;
			blockEdit.updateBlockContent(index, newDisplay + '\n', newCursor);
			pendingCursorOffset = newCursor;
			return;
		}

		const newFenceLen = Math.max(currentFenceLen, maxRunInPaste + 1);
		const newFence = meta.fenceMarker.repeat(newFenceLen);
		const oldFence = meta.fenceMarker.repeat(currentFenceLen);

		const display = el.textContent ?? '';
		const spliced = display.slice(0, start) + text + display.slice(end);
		const lines = spliced.split('\n');
		lines[0] = lines[0].replace(new RegExp('^' + escapeForRegex(oldFence)), newFence);
		if (meta.closed) {
			for (let i = lines.length - 1; i >= 0; i--) {
				if (lines[i].trim().length === 0) continue;
				lines[i] = lines[i].replace(new RegExp('^\\s*' + escapeForRegex(oldFence)), newFence);
				break;
			}
		}
		const bumpedDisplay = lines.join('\n');

		// cursor shifts by the bumped fence's length delta
		const fenceDelta = newFenceLen - currentFenceLen;
		const newCursor = start + fenceDelta + text.length;

		blockEdit.updateBlockContent(index, bumpedDisplay + '\n', newCursor);
		pendingCursorOffset = newCursor;
	}

	function escapeForRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
