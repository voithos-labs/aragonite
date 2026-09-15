<script lang="ts">
	/**
	 * The editor's own formatting popover over a selection, in Notion's shape: a row of the
	 * marks, then labelled rows for what acts on the selection as a whole. Built on the same
	 * doors a host's chrome would use (`selectionChange`, the rect API, the command door), so
	 * the consumer-guide recipe and this component cannot disagree about what a selection
	 * toolbar may read.
	 */
	import type { EditorInstance } from '../../editor-props';
	import type { EditorSelection } from '../../selection/primitives';
	import { normalize as normalizeSelection } from '../../selection/primitives';
	import { SELECTION_END } from '../../block-component';
	import { TOOLBAR_COMMANDS } from '../../schema/commands';
	import { SELECTION_TOOLBAR_LABEL } from '../../a11y-strings';
	import { keepFlyoutOnScreen } from './flyout-placement';
	import { runClipboardAction } from './clipboard-actions';
	import MenuIcon, { type MenuIconName } from './MenuIcon.svelte';

	type ToolbarEditor = Pick<
		EditorInstance,
		| 'getSelection'
		| 'getRects'
		| 'getBlockKindAt'
		| 'runCommand'
		| 'canRunCommand'
		| 'isCommandActive'
		| 'getEvents'
	>;

	// The bar: the three marks and the link. Beneath it, as rows: the heading picker, inline code
	// and copy. The bar sets the card's width.
	const MARKS: readonly { icon: MenuIconName; title: string; command: string; size: number }[] = [
		{ icon: 'bold', title: 'Bold (Ctrl/Cmd+B)', command: TOOLBAR_COMMANDS.toggleStrong, size: 16 },
		{
			icon: 'italic',
			title: 'Italic (Ctrl/Cmd+I)',
			command: TOOLBAR_COMMANDS.toggleEmphasis,
			size: 16
		},
		{
			icon: 'strikethrough',
			title: 'Strikethrough (Ctrl/Cmd+Shift+X)',
			command: TOOLBAR_COMMANDS.toggleStrikethrough,
			size: 16
		},
		{ icon: 'link', title: 'Edit link (Ctrl/Cmd+K)', command: TOOLBAR_COMMANDS.editLink, size: 10 }
	];
	const ROWS: readonly { icon: MenuIconName; label: string; command: string }[] = [
		{ icon: 'code', label: 'Inline code', command: TOOLBAR_COMMANDS.toggleCode }
	];
	const TURN_INTO_COMMAND = TOOLBAR_COMMANDS.setHeading;
	const TURN_INTO: readonly { label: string; level: number }[] = [
		{ label: 'Normal text', level: 0 },
		{ label: 'Heading 1', level: 1 },
		{ label: 'Heading 2', level: 2 },
		{ label: 'Heading 3', level: 3 }
	];
	const BUTTONS = [...MARKS, ...ROWS, { command: TURN_INTO_COMMAND }];
	const BAR_GAP = 6;

	let { editor, root }: { editor: ToolbarEditor; root: HTMLElement | undefined } = $props();

	let turnIntoOpen = $state(false);
	let blockKind = $state<string | null>(null);
	let placement = $state<Placement | null>(null);
	let declined = $state<ReadonlySet<string>>(new Set());
	let active = $state<ReadonlySet<string>>(new Set());
	let current: EditorSelection | null = null;
	let barEl: HTMLDivElement | undefined = $state();

	// A labelled row the door declines leaves the bar, where a mark only dims: the icons keep the
	// bar's shape, a dead row is a line of noise over a selection it cannot act on.
	const rows = $derived(ROWS.filter((row) => !declined.has(row.command)));
	const offersHeading = $derived(!declined.has(TURN_INTO_COMMAND));

	interface Placement {
		x: number;
		y: number;
		/** The selection's first rect, for the flip above when there is no room below. */
		flipY: number;
	}

	// The editor root's top is the floor the flip may not cross: whatever host chrome sits
	// above the editor ends where the root begins.
	function topInset(): number {
		return Math.max(0, root?.getBoundingClientRect().top ?? 0);
	}

	// The document's own copy, so a cross-block range lands as the Markdown Ctrl+C would write.
	function copySelection(): void {
		void runClipboardAction('copy', null);
		placement = null;
	}

	// The bar's own size, measured once it is in the DOM, so the placement can keep it on screen:
	// pushed left at the right edge, flipped above the selection when there is no room below.
	let size = $state<{ w: number; h: number } | null>(null);
	$effect(() => {
		if (!barEl || !placement) return;
		const rect = barEl.getBoundingClientRect();
		size = { w: rect.width, h: rect.height };
	});
	const shown = $derived.by(() => {
		if (!placement) return null;
		if (!size) return { x: placement.x, y: placement.y };
		const margin = 8;
		let { x, y } = placement;
		if (x + size.w > window.innerWidth - margin)
			x = Math.max(margin, window.innerWidth - margin - size.w);
		if (y + size.h > window.innerHeight - margin)
			y = Math.max(topInset() + 4, placement.flipY - size.h - BAR_GAP);
		return { x, y };
	});

	$effect(() => editor.getEvents().on('selectionChange', update));

	// Only once the drag is over: a bar that appears and re-seats under a moving pointer is in the
	// way of the very selection being made. The press is watched at the document, since the drag
	// can end anywhere; the release places the bar from the selection that stood at that moment.
	let pointerHeld = false;
	$effect(() => {
		// A press on the bar itself is a button, not a drag: arming the release here would re-place
		// the bar (and close its flyout) under the click that follows.
		const down = (e: PointerEvent) => {
			if (e.button === 0 && !barEl?.contains(e.target as Node)) pointerHeld = true;
		};
		// Placed from the range the editor last reported; a release that still moves the range
		// reports again through `selectionChange`, which re-places.
		const up = () => {
			if (!pointerHeld) return;
			pointerHeld = false;
			if (current) update(current);
		};
		document.addEventListener('pointerdown', down, true);
		document.addEventListener('pointerup', up, true);
		document.addEventListener('pointercancel', up, true);
		return () => {
			document.removeEventListener('pointerdown', down, true);
			document.removeEventListener('pointerup', up, true);
			document.removeEventListener('pointercancel', up, true);
		};
	});

	// The editor's own right-click menu takes the selection's spot; two cards over one range read
	// as a glitch, so the bar hides while it is open and comes back where the selection still is.
	let menuOpen = false;
	$effect(() =>
		editor.getEvents().on('menuChange', (open) => {
			menuOpen = open;
			if (open) placement = null;
			else if (current) update(current);
		})
	);

	// Sticky with the text: the rects are viewport coordinates, so a scroll or resize moves the
	// selection under the bar and the bar re-measures. Scroll already arrives once per frame.
	$effect(() => {
		const reanchor = () => {
			// Same gates as a selection change: a scroll mid-drag (autoscroll included) must not
			// bring the bar out before the release does.
			if (current) placement = shownOver(current);
		};
		window.addEventListener('scroll', reanchor, { capture: true, passive: true });
		window.addEventListener('resize', reanchor, { passive: true });
		return () => {
			window.removeEventListener('scroll', reanchor, { capture: true });
			window.removeEventListener('resize', reanchor);
		};
	});

	function update(selection: EditorSelection | null): void {
		current = selection;
		turnIntoOpen = false;
		blockKind = selection ? editor.getBlockKindAt(normalizeSelection(selection).start.path) : null;
		// Asked per selection change, not per render: the answers are snapshots of this selection.
		declined = new Set(
			BUTTONS.filter((b) => !editor.canRunCommand(b.command)).map((b) => b.command)
		);
		active = new Set(
			BUTTONS.filter((b) => editor.isCommandActive(b.command)).map((b) => b.command)
		);
		placement = selection ? shownOver(selection) : null;
	}

	// The door decides where the bar belongs: over a code fence or an equation's source it declines
	// every mark, and a bar of greyed buttons is worse than none.
	function shownOver(selection: EditorSelection): Placement | null {
		if (menuOpen || pointerHeld) return null;
		if (MARKS.every((mark) => declined.has(mark.command))) return null;
		return place(selection);
	}

	function place(selection: EditorSelection): Placement | null {
		const { start, end } = normalizeSelection(selection);
		const sameBlock = start.path.join('.') === end.path.join('.');
		if (!sameBlock) {
			// The bar hangs off where the selection ENDS, so the end block's rects come first. A
			// selection that starts at the very end of one block (a drag that left the block
			// upward, or began at the previous paragraph's end) leaves the start block's remaining
			// range empty, so that read is a fallback, and the start block's whole box the last one.
			const rects = editor.getRects();
			const endRects =
				editor.getBlockKindAt(end.path) !== 'table' && end.offset > 0
					? rects.rangeRects(end.path, 0, end.offset)
					: [];
			const anchored = endRects.length
				? endRects
				: rects.rangeRects(start.path, start.offset, SELECTION_END);
			const measured = anchored.length ? anchored : rects.rangeRects(start.path, 0, SELECTION_END);
			return measured.length ? belowRight(measured) : null;
		}
		// An intra-table rectangle shares the table's path and carries cell indices on endpoints the
		// flag need not mark, so the kind read is what excludes it rather than the flag.
		if (editor.getBlockKindAt(start.path) === 'table') return null;
		if (start.offset === end.offset) return null;
		const rects = editor.getRects().rangeRects(start.path, start.offset, end.offset);
		return rects.length ? belowRight(rects) : null;
	}

	/** The bar opens like a menu: below the selection's last line and to the right of where it
	 *  ends, never over the text. The clamp above pushes it left at the viewport edge and flips it
	 *  above the first line when there is no room below. */
	function belowRight(rects: DOMRect[]): Placement | null {
		const first = rects[0];
		const last = rects[rects.length - 1];
		// Scrolled out from under the host's chrome or off the bottom: nothing to anchor to.
		if (last.bottom < topInset() || first.top > window.innerHeight) return null;
		return { x: last.right + BAR_GAP, y: last.bottom + BAR_GAP, flipY: first.top };
	}

	// The id, not a synthesized chord: a host rebind moves the shortcut and leaves the button. A
	// declined run means the bar's premise went stale under it, so the boolean hides the bar.
	function fire(command: string, arg?: unknown): void {
		turnIntoOpen = false;
		if (!editor.runCommand(command, arg)) placement = null;
	}
</script>

{#if shown}
	<div
		bind:this={barEl}
		class="md-menu selection-toolbar"
		data-testid="selection-toolbar"
		style:left="{shown.x}px"
		style:top="{shown.y}px"
		role="toolbar"
		aria-label={SELECTION_TOOLBAR_LABEL}
		tabindex="-1"
		onpointerleave={() => (turnIntoOpen = false)}
	>
		<div class="selection-toolbar-marks">
			{#each MARKS as button (button.command)}
				<button
					type="button"
					class="md-menu-item selection-toolbar-mark"
					data-testid="toolbar-{button.command}"
					title={button.title}
					disabled={declined.has(button.command)}
					aria-pressed={active.has(button.command)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => fire(button.command)}
				>
					<MenuIcon name={button.icon} size={button.size} />
				</button>
			{/each}
		</div>
		<div class="md-menu-divider" aria-hidden="true"></div>
		{#if offersHeading}
			<div
				class="selection-toolbar-row"
				role="presentation"
				onpointerenter={() => (turnIntoOpen = true)}
			>
				<button
					type="button"
					class="md-menu-item"
					data-testid="toolbar-set-heading"
					aria-haspopup="menu"
					aria-expanded={turnIntoOpen}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => (turnIntoOpen = !turnIntoOpen)}
				>
					<span class="md-menu-icon"><MenuIcon name="heading" size={14} /></span>
					<span class="selection-toolbar-label">Set heading</span>
					<span class="md-menu-icon"><MenuIcon name="chevron-right" size={13} /></span>
				</button>
				{#if turnIntoOpen}
					<div class="md-menu selection-toolbar-flyout" role="menu" {@attach keepFlyoutOnScreen}>
						{#each TURN_INTO as option (option.level)}
							{@const chosen = option.level === 0 ? blockKind === 'paragraph' : false}
							<button
								type="button"
								class="md-menu-item"
								role="menuitemradio"
								data-testid="toolbar-set-heading-{option.level}"
								aria-checked={chosen}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => fire(TURN_INTO_COMMAND, option.level)}
							>
								<span class="selection-toolbar-label">{option.label}</span>
								{#if chosen}<span class="md-menu-icon"><MenuIcon name="check" size={13} /></span
									>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		{#each rows as row (row.command)}
			<button
				type="button"
				class="md-menu-item"
				data-testid="toolbar-{row.command}"
				aria-pressed={active.has(row.command)}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => fire(row.command)}
			>
				<span class="md-menu-icon"><MenuIcon name={row.icon} size={14} /></span>
				<span class="selection-toolbar-label">{row.label}</span>
				{#if active.has(row.command)}<span class="md-menu-icon"
						><MenuIcon name="check" size={13} /></span
					>{/if}
			</button>
		{/each}
		<button
			type="button"
			class="md-menu-item"
			data-testid="toolbar-copy"
			onmousedown={(e) => e.preventDefault()}
			onclick={copySelection}
		>
			<span class="md-menu-icon"><MenuIcon name="copy" size={14} /></span>
			<span>Copy</span>
		</button>
	</div>
{/if}

<style>
	/* Surface and rows are the shared `.md-menu` family (editor.css); only the marks row and the
	   flyout hang are this popover's own. */
	.selection-toolbar {
		z-index: 100;
		min-width: 0;
		width: calc(4 * 34px + 3 * 2px + 2 * 6px);
		white-space: nowrap;
	}
	.selection-toolbar-marks {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
	}
	.selection-toolbar-mark {
		flex: 0 0 34px;
		justify-content: center;
		width: 34px;
		height: 30px;
		padding: 0;
		color: var(--color-ui-muted, #8f8f89);
	}
	.selection-toolbar-mark:hover:not(:disabled),
	.selection-toolbar-mark[aria-pressed='true'] {
		color: var(--color-text-primary, #e8e8e5);
	}
	/* The marks are serif letters; a Lucide outline beside them needs a heavier stroke to weigh
	   the same. */
	.selection-toolbar-mark :global(svg) {
		stroke-width: 2.2;
	}
	.selection-toolbar-row {
		position: relative;
	}
	.selection-toolbar-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.selection-toolbar-flyout {
		position: absolute;
		left: 100%;
		top: -4px;
		margin-left: 4px;
		min-width: 150px;
	}
</style>
