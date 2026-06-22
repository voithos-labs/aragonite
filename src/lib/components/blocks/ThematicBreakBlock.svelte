<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
	import type { BlockComponent } from '../../block-component';
	import type { CstNode } from '../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		KEYBINDING_OVERRIDES_KEY,
		type KeybindingOverridesGetter
	} from '../../editor-keys';
	import { eventToChord } from '../../schema/keybindings';
	import { resolveBinding, getCommand, isEditorGlobalChord } from '../../schema/commands';
	import { displayLength } from '../../core/lines';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const keybindingOverrides = getContext<KeybindingOverridesGetter>(KEYBINDING_OVERRIDES_KEY);
	let el: HTMLDivElement | undefined = $state();

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = false;
	export const focusable = true;

	export function focus(_offset: number): void {
		el?.focus();
	}

	export function getCursorOffset(): number | null {
		if (!el || document.activeElement !== el) return null;
		return 0;
	}
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	// ── Event Handlers ──────────────────────────────────────────────────

	function onKeyDown(e: KeyboardEvent): void {
		// The editor owns undo/redo; resolve override-aware so a consumer can rebind
		// or disable these chords even while a thematic break is focused.
		const chord = eventToChord(e);
		if (chord && isEditorGlobalChord(chord)) {
			e.preventDefault();
			const binding = resolveBinding(chord, node.kind, keybindingOverrides());
			if (binding) getCommand(binding.command)?.({ history });
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			blockEdit.splitBlock(index, displayLength(node.raw));
			return;
		}

		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			blockEdit.deleteBlock(index);
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusActions.moveFocus(index - 1, { stickyColumnFrom: 'below' });
			return;
		}

		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			focusActions.moveFocus(index - 1, 'end');
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusActions.moveFocus(index + 1, { stickyColumnFrom: 'above' });
			return;
		}

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			focusActions.moveFocus(index + 1, 'start');
			return;
		}
	}
</script>

<div
	bind:this={el}
	tabindex="0"
	class="thematic-break-block"
	role="separator"
	onkeydown={onKeyDown}
>
	<hr />
</div>

<style>
	.thematic-break-block {
		outline: none;
		padding: 8px 0;
	}

	.thematic-break-block:focus {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: 2px;
		border-radius: 2px;
	}

	hr {
		border: none;
		border-top: 2px solid var(--color-ui-muted, #a4a4a4);
		margin: 0;
	}
</style>
