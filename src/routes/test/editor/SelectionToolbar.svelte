<script lang="ts">
	/**
	 * Consumer-side rect-API example: no plugin, no internal imports, no native selection
	 * reads. The bar re-anchors on the next selection change, not on scroll, and its buttons
	 * run command ids rather than synthetic chords.
	 */
	import {
		SELECTION_END,
		TOOLBAR_COMMANDS,
		type EditorInstance,
		type EditorSelection,
		type SelectionPoint
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

	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', update);
	});

	function update(selection: EditorSelection | null): void {
		placement = selection ? place(selection) : null;
	}

	function place(selection: EditorSelection): Placement | null {
		if (selection.anchor.path.join('.') !== selection.focus.path.join('.')) {
			const start = startPoint(selection);
			// Rects from the start offset through the start block's last measurable position.
			const rects = editor!.getRects().rangeRects(start.path, start.offset, SELECTION_END);
			return rects.length ? above(rects[0], 'cross-block') : null;
		}
		// Same block: the snapshot carries real range offsets, so the public API serves both
		// extent and geometry. Cell-coordinate pairs (an intra-table rect) keep the bar hidden.
		if (selection.anchor.cellCoordinate || selection.focus.cellCoordinate) return null;
		const lo = Math.min(selection.anchor.offset, selection.focus.offset);
		const hi = Math.max(selection.anchor.offset, selection.focus.offset);
		if (lo === hi) return null;
		const rects = editor!.getRects().rangeRects(selection.focus.path, lo, hi);
		return rects.length ? above(rects[0], `${hi - lo} chars`) : null;
	}

	function above(rect: DOMRect, label: string): Placement {
		return { x: rect.left, y: Math.max(4, rect.top - BAR_HEIGHT), label };
	}

	/** The bar's own height plus a gap, so the buttons never cover the selected line. */
	const BAR_HEIGHT = 40;

	// The id, not a synthesized chord: a host rebind moves the shortcut and leaves the button. The
	// answer is read because this bar stays up over cross-block ranges, where a toggle declines.
	function fire(command: string): void {
		if (!editor) return;
		if (!editor.runCommand(command) && placement) placement = { ...placement, label: 'declined' };
	}

	/** The endpoint earlier in document order — path-lexicographic, then offset. */
	function startPoint(selection: EditorSelection): SelectionPoint {
		const { anchor: a, focus: f } = selection;
		const len = Math.min(a.path.length, f.path.length);
		for (let i = 0; i < len; i++) {
			if (a.path[i] !== f.path[i]) return a.path[i] < f.path[i] ? a : f;
		}
		if (a.path.length !== f.path.length) return a.path.length < f.path.length ? a : f;
		return a.offset <= f.offset ? a : f;
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
	.toolbar-label {
		padding-left: 0.2rem;
	}
</style>
