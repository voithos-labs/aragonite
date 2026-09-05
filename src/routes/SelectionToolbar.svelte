<script lang="ts">
	/**
	 * Consumer-side rect-API example, mounted by the showcase and the dev harness alike: no
	 * plugin, no internal imports, no native selection reads. The bar re-anchors on the next
	 * selection change, not on scroll, and its buttons run command ids rather than synthetic
	 * chords (consumer-guide.md § Recipe: a selection toolbar).
	 */
	import {
		SELECTION_END,
		TOOLBAR_COMMANDS,
		normalizeSelection,
		type EditorInstance,
		type EditorSelection
	} from '$lib';

	const BUTTONS = [
		{ label: 'B', title: 'Bold (Ctrl/Cmd+B)', command: TOOLBAR_COMMANDS.toggleStrong },
		{ label: 'I', title: 'Italic (Ctrl/Cmd+I)', command: TOOLBAR_COMMANDS.toggleEmphasis },
		{
			label: 'S',
			title: 'Strikethrough (Ctrl/Cmd+Shift+X)',
			command: TOOLBAR_COMMANDS.toggleStrikethrough
		},
		{ label: '<>', title: 'Inline code (Ctrl/Cmd+E)', command: TOOLBAR_COMMANDS.toggleCode },
		{ label: 'Link', title: 'Edit link (Ctrl/Cmd+K)', command: TOOLBAR_COMMANDS.editLink }
	] as const;

	interface Placement {
		x: number;
		y: number;
	}

	// Only the host knows where its own fixed chrome ends, so the clearance floor arrives as a
	// prop rather than a viewport guess.
	let { editor, topInset = 0 }: { editor: EditorInstance | undefined; topInset?: number } =
		$props();

	let placement = $state<Placement | null>(null);
	let declined = $state<ReadonlySet<string>>(new Set());
	let active = $state<ReadonlySet<string>>(new Set());

	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', update);
	});

	function update(selection: EditorSelection | null): void {
		placement = selection ? place(selection) : null;
		// Asked per selection change, not per render: the answers are snapshots of this selection.
		declined = new Set(
			BUTTONS.filter((b) => !editor?.canRunCommand(b.command)).map((b) => b.command)
		);
		active = new Set(
			BUTTONS.filter((b) => editor?.isCommandActive(b.command)).map((b) => b.command)
		);
	}

	function place(selection: EditorSelection): Placement | null {
		const { start, end } = normalizeSelection(selection);
		const sameBlock = start.path.join('.') === end.path.join('.');
		if (!sameBlock) {
			// Rects from the start offset through the start block's last measurable position.
			const rects = editor!.getRects().rangeRects(start.path, start.offset, SELECTION_END);
			return rects.length ? above(rects[0]) : null;
		}
		// An intra-table rectangle shares the table's path and carries cell indices on endpoints the
		// flag need not mark, so the kind read is what excludes it rather than the flag.
		if (editor!.getBlockKindAt(start.path) === 'table') return null;
		if (start.offset === end.offset) return null;
		const rects = editor!.getRects().rangeRects(start.path, start.offset, end.offset);
		return rects.length ? above(rects[0]) : null;
	}

	/** How far above the selection the bar sits: its own height plus a gap, so the buttons never
	 *  cover the line the user selected. A selection too close to the host's chrome flips the bar
	 *  below itself instead, so it never lands on controls it does not own. */
	const BAR_CLEARANCE = 40;
	const BAR_GAP = 8;

	function above(rect: DOMRect): Placement {
		const y = rect.top - BAR_CLEARANCE;
		return y >= topInset + 4 ? { x: rect.left, y } : { x: rect.left, y: rect.bottom + BAR_GAP };
	}

	// The id, not a synthesized chord: a host rebind moves the shortcut and leaves the button. A
	// declined run means the bar's premise went stale under it, so the boolean hides the bar.
	function fire(command: string): void {
		if (editor && !editor.runCommand(command)) placement = null;
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
				aria-pressed={active.has(button.command)}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => fire(button.command)}
			>
				{button.label}
			</button>
		{/each}
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.35rem;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		background: var(--color-surface, #1b1c21);
		color: var(--color-text-secondary, #888);
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.75rem;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
	}
	.toolbar-btn {
		padding: 0.15rem 0.4rem;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		line-height: 1.2;
		cursor: pointer;
	}
	.toolbar-btn:hover:not(:disabled),
	.toolbar-btn[aria-pressed='true'] {
		color: var(--color-text-primary, #fff);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.18));
	}
	.toolbar-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
