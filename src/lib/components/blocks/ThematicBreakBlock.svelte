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
	import { type CommandId } from '../../schema/commands';
	import { dispatchKeyCommand, type CommandErrorSink } from '../../schema/block-commands';
	import {
		handleEditorGlobalChord,
		handleWholeBlockKeys
	} from '../../editor-actions/container-block-component';
	import { createWholeBlockInputProxy } from '../../editor-actions/whole-block-focus-surface';
	import { placeCaret } from '../../selection/caret-doors';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const blockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const focusActions = getContext<FocusActions>(FOCUS_KEY);
	const history = getContext<HistoryActions>(HISTORY_KEY);
	const {
		reorder,
		stickyColumn,
		edgeAffinity,
		selection,
		events: editorEvents
	} = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { keybindingOverrides, presentationMode: getPresentationMode } =
		getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const pluginEditor = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.pluginEditor;
	const onCommandError: CommandErrorSink = (report) => emitCommandError(editorEvents, report);
	// Tabindex-focusable independent of contenteditable, so keydown stays live in
	// reading mode; the edit branches below gate on this instead.
	const isReading = () => getPresentationMode?.() === 'reading';
	let boxEl: HTMLDivElement | undefined = $state();
	let el: HTMLDivElement | undefined = $state();

	// The editing host AltGr and IME input arrive through: keydown alone drops both, and this
	// block has no editable surface of its own to catch them.
	const inputProxy = createWholeBlockInputProxy({
		getBoxEl: () => boxEl,
		getFocusEl: () => el,
		isReading,
		mint: (text) => void blockEdit.insertParagraph(index + 1, text)
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = false;
	export const focusable = true;

	// The block IS its own focus target, so the offset carries no meaning — but the
	// range-ending is still owed: nothing below seats a DOM caret to collapse it.
	export const focus = placeCaret(selection, parkCaret);

	export function parkCaret(_offset: number): void {
		if (el) inputProxy.focus(el);
	}

	// `contains`, not identity: focus lands on the hidden host beside the separator.
	export function getCursorOffset(): number | null {
		if (!boxEl || !boxEl.contains(document.activeElement)) return null;
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
	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		runCommand
	} satisfies BlockComponent);

	// ── Event Handlers ──────────────────────────────────────────────────

	// Shared with the plugin container factory, so undo/redo from a block's own focus
	// surface has one definition instead of a built-in and a plugin copy.
	const globalChordDeps = {
		getKind: () => node.kind,
		history,
		pluginEditor,
		onCommandError,
		getKeybindingOverrides: keybindingOverrides,
		isReading
	};

	function onKeyDown(e: KeyboardEvent): void {
		const chord = eventToChord(e);
		if (chord && handleEditorGlobalChord(chord, globalChordDeps)) {
			e.preventDefault();
			return;
		}

		// Kind keymap (Alt+↑/↓ reorder) must precede the plain-arrow navigation below.
		if (
			chord &&
			dispatchKeyCommand(
				chord,
				{ kind: node.kind, runCommand },
				{
					history,
					pluginEditor,
					getPresentationMode,
					isCrossBlockRange: () => selection.isCrossBlock
				},
				keybindingOverrides(),
				onCommandError
			)
		) {
			e.preventDefault();
			return;
		}

		// The whole-block-focus key tail, shared with the plugin container factory.
		handleWholeBlockKeys(e, {
			getIndex: () => index,
			getRaw: () => node.raw,
			blockEdit,
			focus: focusActions,
			isReading,
			stickyColumn,
			edgeAffinity
		});
	}
</script>

<!-- The box holds the separator and the editor's hidden input host as SIBLINGS: focusable
     content inside a focusable widget is not reachable by every AT (axe nested-interactive). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={boxEl} class="thematic-break-block" onkeydown={onKeyDown}>
	<!-- Focusable by pointer and by the editor, never by Tab: the host beside it is the block's
	     one tab stop. The role/naming question is the 1.1 shell a11y decision. -->
	<div bind:this={el} tabindex="-1" class="thematic-break-rule" role="separator">
		<hr />
	</div>
</div>

<style>
	/* Positioned so the hidden input host resolves against the block; the padding lives on the
	   rule below, so a click anywhere in the box lands on the focusable element. */
	.thematic-break-block {
		position: relative;
	}

	.thematic-break-rule {
		outline: none;
		padding: 8px 0;
	}

	/* `:focus-within`: whole-block focus lands on the host, not the separator. */
	.thematic-break-block:focus-within .thematic-break-rule {
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
