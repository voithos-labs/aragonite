<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockEditActions, FocusActions, HistoryActions } from '../../action-contracts';
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import { emitCommandError } from '../../editor-events';
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
	} from '../../editor-keys';
	import { eventToChord } from '../../schema/keybindings';
	import {
		resolveBinding,
		getCommand,
		isEditorGlobalChord,
		type CommandId
	} from '../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../schema/block-commands';
	import { handleWholeBlockKeys } from '../../editor-actions/container-block-component';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const { reorder, events: editorEvents } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationMode } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const pluginEditor = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.pluginEditor;
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	// This block is tabindex-focusable independent of contenteditable, so its
	// keydown stays live in reading mode: arrows (navigation) stay, the direct
	// edit branches below gate.
	const isReading = () => getPresentationMode?.() === 'reading';
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

	export function runCommand(id: CommandId): boolean {
		switch (id) {
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
	void ({ editable, focusable, focus, getCursorOffset, runCommand } satisfies BlockComponent);

	// ── Event Handlers ──────────────────────────────────────────────────

	function onKeyDown(e: KeyboardEvent): void {
		// The editor owns undo/redo; resolve override-aware so a consumer can rebind
		// or disable these chords even while a thematic break is focused. Runs
		// getCommand directly (no dispatchKeyCommand), so it carries the
		// reading-mode gate itself — sibling: the editor-root branch.
		const chord = eventToChord(e);
		if (chord && isEditorGlobalChord(chord)) {
			e.preventDefault();
			if (isReading()) return;
			const binding = resolveBinding(chord, node.kind, keybindingOverrides());
			if (binding) getCommand(binding.command)?.({ history, pluginEditor, onCommandError });
			return;
		}

		// Kind keymap (Alt+↑/↓ reorder) before the plain-arrow navigation below,
		// which is guarded on no-modifier so a modified arrow never falls through.
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

		// The whole-block-focus key tail (Enter-below, focus-delete, arrow traversal,
		// reading gate) is shared with the plugin container factory — see
		// handleWholeBlockKeys. Alt-arrow reorder is handled above through the kind
		// keymap, so it never reaches here.
		handleWholeBlockKeys(e, {
			getIndex: () => index,
			getRaw: () => node.raw,
			blockEdit,
			focus: focusActions,
			isReading
		});
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
