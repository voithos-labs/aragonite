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
		type BlockComponent
	} from '../../editor-types';
	import { PRESERVE_KEYS_NON_ARROW, type StickyColumnState } from '../../sticky-column';
	import { trimTrailingLineEnding } from '../../raw-text';

	let { node, index }: { node: CstNode; index: number } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	let textarea: HTMLTextAreaElement | undefined = $state();
	let userIsTyping = false;
	let preEditOffset = 0;

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!textarea) return;
		textarea.focus();
		const maxOffset = textarea.value.length;
		const clamped = Math.min(Math.max(0, offset), maxOffset);
		textarea.selectionStart = textarea.selectionEnd = clamped;
	}

	export function getCursorOffset(): number | null {
		if (!textarea || document.activeElement !== textarea) return null;
		return textarea.selectionStart;
	}

	export function getSelectedText(): string {
		if (!textarea) return '';
		return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
	}

	export function setSelection(start: number, end: number): void {
		if (!textarea) return;
		textarea.selectionStart = start;
		textarea.selectionEnd = end;
	}
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	// ── Content sync ────────────────────────────────────────────────────

	function getDisplayText(): string {
		return trimTrailingLineEnding(node.raw);
	}

	$effect(() => {
		const display = getDisplayText();
		if (!textarea || userIsTyping) return;
		if (textarea.value !== display) {
			textarea.value = display;
		}
		autoResize();
	});

	function autoResize(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = textarea.scrollHeight + 'px';
	}

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		stickyColumn.reset();
		if (!textarea) return;
		userIsTyping = true;
		blockEdit.updateBlockContent(index, textarea.value + '\n', preEditOffset);
		userIsTyping = false;
		autoResize();
	}

	function onCompositionStart(): void {
		stickyColumn.reset();
	}

	function onPointerDown(_e: PointerEvent): void {
		stickyColumn.reset();
	}

	function onKeyDown(e: KeyboardEvent): void {
		// Sticky column: reset on any non-arrow interaction inside the code block.
		// Arrows stay preserve-keys because the code block cannot capture its own
		// sticky X (no pixel API on textarea) — passing through without resetting
		// keeps a pre-existing sticky X valid for whatever the user does next.
		// PRESERVE_KEYS_NON_ARROW is shared with TextEditableBlock; see its JSDoc
		// in sticky-column.ts for the full preserve/reset policy.
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && !PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
			stickyColumn.reset();
		}

		preEditOffset = textarea?.selectionStart ?? 0;

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

		if (e.key === 'Backspace' && textarea) {
			if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if (e.key === 'ArrowUp' && !e.shiftKey && textarea) {
			// No newline before cursor means we're on the first visual line.
			const textBefore = textarea.value.slice(0, textarea.selectionStart);
			if (!textBefore.includes('\n')) {
				e.preventDefault();
				focusActions.moveFocus(index - 1, 'end');
				return;
			}
		}

		if (e.key === 'ArrowDown' && !e.shiftKey && textarea) {
			const textAfter = textarea.value.slice(textarea.selectionStart);
			if (!textAfter.includes('\n')) {
				e.preventDefault();
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}

		// Enter at end, when the last line is already empty, exits the code block.
		if (e.key === 'Enter' && !e.shiftKey && textarea) {
			const pos = textarea.selectionStart;
			const val = textarea.value;
			// Check: cursor is at the end, and the last line is empty
			if (pos === val.length && val.endsWith('\n')) {
				e.preventDefault();
				// Remove the trailing empty line from the code block
				const trimmed = val.slice(0, -1);
				blockEdit.updateBlockContent(index, trimmed + '\n', preEditOffset);
				textarea.value = trimmed;
				autoResize();
				// Create a new block after the code block
				focusActions.moveFocus(index + 1, 'start');
				return;
			}
		}
	}

	// Clipboard — intercept to source from node.raw
	function onCopy(e: ClipboardEvent): void {
		stickyColumn.reset();
		if (!textarea) return;
		e.preventDefault();
		const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
		e.clipboardData?.setData('text/plain', text);
	}

	function onCut(e: ClipboardEvent): void {
		stickyColumn.reset();
		if (!textarea) return;
		e.preventDefault();
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const text = textarea.value.slice(start, end);
		e.clipboardData?.setData('text/plain', text);

		const newValue = textarea.value.slice(0, start) + textarea.value.slice(end);
		blockEdit.updateBlockContent(index, newValue + '\n');
		textarea.value = newValue;
		textarea.selectionStart = textarea.selectionEnd = start;
		autoResize();
	}

	function onPaste(e: ClipboardEvent): void {
		stickyColumn.reset();
		if (!textarea) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const newValue = textarea.value.slice(0, start) + text + textarea.value.slice(end);
		blockEdit.updateBlockContent(index, newValue + '\n');
		textarea.value = newValue;
		textarea.selectionStart = textarea.selectionEnd = start + text.length;
		autoResize();
	}
</script>

<textarea
	bind:this={textarea}
	class="code-block"
	value={getDisplayText()}
	oninput={onInput}
	onkeydown={onKeyDown}
	oncopy={onCopy}
	oncut={onCut}
	onpaste={onPaste}
	onpointerdown={onPointerDown}
	oncompositionstart={onCompositionStart}
	spellcheck={false}
></textarea>

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
		resize: none;
		overflow: hidden;
		white-space: pre;
		tab-size: 4;
		box-sizing: border-box;
	}

	.code-block:focus {
		border-color: var(--color-accent, #4a9eff);
	}
</style>
