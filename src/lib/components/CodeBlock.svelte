<script lang="ts">
	import { getContext } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type CstNode,
		type BlockComponent
	} from '../editor-types';

	let { node, index }: { node: CstNode; index: number } = $props();

	const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
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

	// ── Content sync ────────────────────────────────────────────────────

	function getDisplayText(): string {
		let text = node.raw;
		if (text.endsWith('\r\n')) text = text.slice(0, -2);
		else if (text.endsWith('\n')) text = text.slice(0, -1);
		return text;
	}

	$effect(() => {
		const display = getDisplayText();
		if (!textarea || userIsTyping) return;
		if (textarea.value !== display) {
			textarea.value = display;
			autoResize();
		}
	});

	function autoResize(): void {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = textarea.scrollHeight + 'px';
	}

	// ── Event Handlers ──────────────────────────────────────────────────

	function onInput(): void {
		if (!textarea) return;
		userIsTyping = true;
		actions.updateBlockContent(index, textarea.value + '\n', preEditOffset);
		userIsTyping = false;
		autoResize();
	}

	function onKeyDown(e: KeyboardEvent): void {
		preEditOffset = textarea?.selectionStart ?? 0;

		// Undo/Redo
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			actions.requestUndo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			actions.requestRedo();
			return;
		}

		// Backspace at position 0 → move focus to previous block
		if (e.key === 'Backspace' && textarea) {
			if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
				e.preventDefault();
				actions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowUp at start → move to previous block
		if (e.key === 'ArrowUp' && !e.shiftKey && textarea) {
			// At position 0 or within the first line
			const textBefore = textarea.value.slice(0, textarea.selectionStart);
			if (!textBefore.includes('\n')) {
				e.preventDefault();
				actions.moveFocus(index - 1, 'end');
				return;
			}
		}

		// ArrowDown at end → move to next block
		if (e.key === 'ArrowDown' && !e.shiftKey && textarea) {
			const textAfter = textarea.value.slice(textarea.selectionStart);
			if (!textAfter.includes('\n')) {
				e.preventDefault();
				actions.moveFocus(index + 1, 'start');
				return;
			}
		}

		// Enter: let textarea handle naturally (inserts newline)
	}

	// Clipboard — intercept to source from node.raw
	function onCopy(e: ClipboardEvent): void {
		if (!textarea) return;
		e.preventDefault();
		const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
		e.clipboardData?.setData('text/plain', text);
	}

	function onCut(e: ClipboardEvent): void {
		if (!textarea) return;
		e.preventDefault();
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const text = textarea.value.slice(start, end);
		e.clipboardData?.setData('text/plain', text);

		const newValue = textarea.value.slice(0, start) + textarea.value.slice(end);
		actions.updateBlockContent(index, newValue + '\n');
		textarea.value = newValue;
		textarea.selectionStart = textarea.selectionEnd = start;
		autoResize();
	}

	function onPaste(e: ClipboardEvent): void {
		if (!textarea) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;

		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const newValue = textarea.value.slice(0, start) + text + textarea.value.slice(end);
		actions.updateBlockContent(index, newValue + '\n');
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
		background: var(--color-bg-secondary, #1e1e1e);
		border: 1px solid var(--color-ui-muted, #333);
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
