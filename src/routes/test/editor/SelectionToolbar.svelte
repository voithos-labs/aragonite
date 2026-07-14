<script lang="ts">
	/**
	 * Consumer-side rect-API example: no plugin, no internal imports — a
	 * `bind:this` EditorInstance, `selectionChange` for lifecycle, `rangeRects`
	 * for the cross-block anchor, and the native Range for the single-block
	 * case. Scroll is v1 non-glue: the bar re-anchors on the next selection
	 * change, not on scroll.
	 */
	import {
		SELECTION_END,
		type EditorInstance,
		type EditorSelection,
		type SelectionPoint
	} from '$lib';

	interface Placement {
		x: number;
		y: number;
		label: string;
	}

	let {
		editor,
		container
	}: { editor: EditorInstance | undefined; container: HTMLElement | undefined } = $props();

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
		// The selection snapshot collapses a single-block range to the focus caret
		// (docs/issues.md, "Selection snapshot collapses single-block ranges"), so
		// the native Range is the only consumer-readable source of the range's
		// extent and geometry today.
		const native = window.getSelection();
		if (!native || native.rangeCount === 0 || native.isCollapsed) return null;
		const range = native.getRangeAt(0);
		if (container && !container.contains(range.commonAncestorContainer)) return null;
		const rect = range.getClientRects()[0];
		if (!rect) return null;
		return above(rect, `${native.toString().length} chars`);
	}

	function above(rect: DOMRect, label: string): Placement {
		return { x: rect.left, y: Math.max(4, rect.top - 34), label };
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
		{placement.label}
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 0.3rem;
		background: var(--color-bg-primary, #1e1e1e);
		color: var(--color-text-secondary, #888);
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.75rem;
		white-space: nowrap;
	}
</style>
