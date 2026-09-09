<script lang="ts">
	/**
	 * Consumer-side rect-API example, mounted by the showcase and the dev harness alike: no
	 * plugin, no internal imports, no native selection reads. The bar re-anchors on every
	 * selection change and on scroll, so it stays with the text it acts on, and its buttons
	 * run command ids rather than synthetic chords (consumer-guide.md § Recipe: a selection
	 * toolbar).
	 */
	import {
		SELECTION_END,
		TOOLBAR_COMMANDS,
		normalizeSelection,
		type EditorInstance,
		type EditorSelection
	} from '$lib';
	import MenuIcon, { type MenuIconName } from '$lib/components/menu/MenuIcon.svelte';

	const BUTTONS: readonly { icon: MenuIconName; title: string; command: string }[] = [
		{ icon: 'bold', title: 'Bold (Ctrl/Cmd+B)', command: TOOLBAR_COMMANDS.toggleStrong },
		{ icon: 'italic', title: 'Italic (Ctrl/Cmd+I)', command: TOOLBAR_COMMANDS.toggleEmphasis },
		{
			icon: 'strikethrough',
			title: 'Strikethrough (Ctrl/Cmd+Shift+X)',
			command: TOOLBAR_COMMANDS.toggleStrikethrough
		},
		{ icon: 'code', title: 'Inline code (Ctrl/Cmd+E)', command: TOOLBAR_COMMANDS.toggleCode },
		{ icon: 'link', title: 'Edit link (Ctrl/Cmd+K)', command: TOOLBAR_COMMANDS.editLink }
	];

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
	let current: EditorSelection | null = null;

	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', update);
	});

	// Sticky with the text: the rects are viewport coordinates, so a scroll or resize moves the
	// selection under the bar and the bar re-measures. One frame per burst, not one per event.
	$effect(() => {
		let frame = 0;
		const reanchor = () => {
			if (frame || !current) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				placement = current ? place(current) : null;
			});
		};
		window.addEventListener('scroll', reanchor, { capture: true, passive: true });
		window.addEventListener('resize', reanchor, { passive: true });
		return () => {
			window.removeEventListener('scroll', reanchor, { capture: true });
			window.removeEventListener('resize', reanchor);
			if (frame) cancelAnimationFrame(frame);
		};
	});

	function update(selection: EditorSelection | null): void {
		current = selection;
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

	function above(rect: DOMRect): Placement | null {
		// Scrolled out from under the host's chrome or off the bottom: nothing to anchor to.
		if (rect.bottom < topInset || rect.top > window.innerHeight) return null;
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
				<MenuIcon name={button.icon} size={15} />
			</button>
		{/each}
	</div>
{/if}

<style>
	/* limestone's menu surface, laid flat: a raised hairlined pill of icon buttons. */
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 8px;
		background: var(--color-bg, #2c2c2a);
		color: var(--color-ui-muted, #8f8f89);
		font-family: var(--font-ui, system-ui, sans-serif);
		white-space: nowrap;
		box-shadow: var(--menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.3));
	}
	.toolbar-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.toolbar-btn:hover:not(:disabled),
	.toolbar-btn[aria-pressed='true'] {
		color: var(--color-text-primary, #e8e8e5);
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
	}
	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>