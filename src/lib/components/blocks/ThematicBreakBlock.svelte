<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import {
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type EditorPolicies,
		type EditorServices
	} from '../../editor-keys';
	import { eventToChord } from '../../schema/keybindings';
	import { type CommandId } from '../../schema/commands';
	import {
		handleEditorGlobalChord,
		handleWholeBlockKeys
	} from '../../editor-actions/container-block-component';
	import { reorderRunCommand } from '../../editor-actions/reorder-action';
	import { createWholeBlockInputProxy } from '../../editor-actions/whole-block-focus-surface';
	import { placeCaret } from '../../selection/caret-doors';
	import { wireSurfaceContexts } from './surface-wiring.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const wiring = wireSurfaceContexts();
	const {
		blockEdit,
		focusActions,
		history,
		pluginEditor,
		onCommandError,
		getKeybindingOverrides,
		stickyColumn,
		edgeAffinity,
		selection
	} = wiring.deps;
	const { reorder, activePlugins } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { presentationMode: getPresentationMode } = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
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
		return reorderRunCommand(id, reorder, () => myPath);
	}

	// The rule has no text to measure, so any non-empty range over it is its whole box — what a
	// range ending on it, or the rule taken as a unit, paints.
	export function measurePartialRects(startOffset: number, endOffset: number): DOMRect[] {
		if (endOffset <= startOffset || !boxEl) return [];
		return [boxEl.getBoundingClientRect()];
	}
	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		runCommand,
		measurePartialRects
	} satisfies BlockComponent);

	// ── Event Handlers ──────────────────────────────────────────────────

	// Shared with the plugin container factory, so undo/redo from a block's own focus
	// surface has one definition instead of a built-in and a plugin copy.
	const globalChordDeps = {
		getKind: () => node.kind,
		history,
		pluginEditor,
		onCommandError,
		getKeybindingOverrides,
		isReading,
		activation: activePlugins
	};

	function onKeyDown(e: KeyboardEvent): void {
		const chord = eventToChord(e);
		if (chord && handleEditorGlobalChord(chord, globalChordDeps)) {
			e.preventDefault();
			return;
		}

		// Kind keymap (Alt+↑/↓ reorder) must precede the plain-arrow navigation below.
		if (wiring.dispatchChord(e, { kind: node.kind, runCommand })) return;

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

	/* The rule is a hairline, so the SPACE around it is what reads as a division. Cramped
	   padding on a heavy line reads as a border instead. */
	.thematic-break-rule {
		outline: none;
		padding: 14px 0;
	}

	/* `:focus-within`: whole-block focus lands on the host, not the separator. Painted as the
	   SAME wash the selection overlay uses, not an accent ring: a rule that showed focus one
	   way and selection another read as two different states of the same block. */
	.thematic-break-block:focus-within .thematic-break-rule {
		background: var(--selection-overlay-bg, rgba(100, 150, 255, 0.3));
		border-radius: 2px;
	}

	hr {
		border: none;
		/* A hairline on the BORDER token, not the muted-UI one: a divider separates, and at
		   2px of mid-grey it competed with the text it sits between. */
		border-top: 1px solid var(--color-border, #3e3e3b);
		margin: 0;
	}
</style>
