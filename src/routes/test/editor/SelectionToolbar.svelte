<script lang="ts">
	/**
	 * Consumer-side rect-API example: no plugin, no internal imports, no native selection
	 * reads. The bar re-anchors on the next selection change, not on scroll, and its buttons
	 * run command ids rather than synthetic chords.
	 */
	import {
		SELECTION_END,
		TOOLBAR_COMMANDS,
		normalizeSelection,
		type EditorInstance,
		type EditorSelection
	} from '$lib';

	const BUTTONS = [
		{ label: 'B', title: 'Bold', command: TOOLBAR_COMMANDS.toggleStrong },
		{ label: 'I', title: 'Italic', command: TOOLBAR_COMMANDS.toggleEmphasis },
		{ label: 'S', title: 'Strikethrough', command: TOOLBAR_COMMANDS.toggleStrikethrough },
		{ label: '<>', title: 'Inline code', command: TOOLBAR_COMMANDS.toggleCode },
		{ label: 'Link', title: 'Edit link', command: TOOLBAR_COMMANDS.editLink }
	] as const;

	interface Placement {
		x: number;
		y: number;
		label: string;
	}

	let { editor }: { editor: EditorInstance | undefined } = $props();

	let placement = $state<Placement | null>(null);
	let declined = $state<ReadonlySet<string>>(new Set());

	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', update);
	});

	function update(selection: EditorSelection | null): void {
		placement = selection ? place(selection) : null;
		// Asked per selection change, not per render: the answer is a snapshot of this selection.
		declined = new Set(
			BUTTONS.filter((b) => !editor?.canRunCommand(b.command)).map((b) => b.command)
		);
	}

	function place(selection: EditorSelection): Placement | null {
		const { start, end } = normalizeSelection(selection);
		const sameBlock = start.path.join('.') === end.path.join('.');
		if (!sameBlock) {
			// Rects from the start offset through the start block's last measurable position.
			const rects = editor!.getRects().rangeRects(start.path, start.offset, SELECTION_END);
			return rects.length ? above(rects[0], 'cross-block') : null;
		}
		// An intra-table rectangle shares the table's path and carries cell indices on endpoints the
		// flag need not mark, so the kind read is what excludes it rather than the flag.
		if (editor!.getBlockKindAt(start.path) === 'table') return null;
		if (start.offset === end.offset) return null;
		const rects = editor!.getRects().rangeRects(start.path, start.offset, end.offset);
		return rects.length ? above(rects[0], `${end.offset - start.offset} chars`) : null;
	}

	/** How far above the selection the bar sits: its own height plus a gap, so the buttons never
	 *  cover the line the user selected. */
	const BAR_CLEARANCE = 40;

	function above(rect: DOMRect, label: string): Placement {
		return { x: rect.left, y: Math.max(4, rect.top - BAR_CLEARANCE), label };
	}

	// The id, not a synthesized chord: a host rebind moves the shortcut and leaves the button. The
	// boolean is still read, since reachability is not success.
	function fire(command: string): void {
		if (!editor) return;
		if (!editor.runCommand(command) && placement) placement = { ...placement, label: 'declined' };
	}
</script>

{#if placement}
	<div
		class="selection-toolbar"
		data-testid="selection-toolbar"
		style:left="{placement.x}px"
		style:top="{placement.y}px"
	>
		{#each BUTTONS as button (button.command)}
			<button
				type="button"
				class="toolbar-btn"
				data-testid="toolbar-{button.command}"
				title={button.title}
				disabled={declined.has(button.command)}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => fire(button.command)}
			>
				{button.label}
			</button>
		{/each}
		<span class="toolbar-label">{placement.label}</span>
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 0.3rem;
		background: var(--color-bg-primary, #1e1e1e);
		color: var(--color-text-secondary, #888);
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.75rem;
		white-space: nowrap;
	}
	.toolbar-btn {
		padding: 0.1rem 0.3rem;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		line-height: 1.2;
		cursor: pointer;
	}
	.toolbar-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.toolbar-label {
		padding-left: 0.2rem;
	}
</style>
