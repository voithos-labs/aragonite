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

	// Notion's selection popover: a row of the marks, then labelled rows for what acts on the
	// selection as a whole. The marks toggle in place; the rows read as menu items.
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
		{ icon: 'link', title: 'Edit link (Ctrl/Cmd+K)', command: TOOLBAR_COMMANDS.editLink, size: 12 }
	];
	const ROWS: readonly { icon: MenuIconName; label: string; command: string }[] = [
		{ icon: 'code', label: 'Inline code', command: TOOLBAR_COMMANDS.toggleCode }
	];
	// "Set heading": the existing `heading.cycle` arm with its level argument — 0 is normal text.
	const TURN_INTO_COMMAND = 'heading.cycle';
	const TURN_INTO: readonly { label: string; level: number }[] = [
		{ label: 'Normal text', level: 0 },
		{ label: 'Heading 1', level: 1 },
		{ label: 'Heading 2', level: 2 },
		{ label: 'Heading 3', level: 3 }
	];
	const BUTTONS = [...MARKS, ...ROWS, { command: TURN_INTO_COMMAND }];
	// The bar's width, which the rows must fit inside: four buttons and their gaps, plus padding.
	const BAR_BUTTON = 34;
	const PROSE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'setextHeading']);
	let turnIntoOpen = $state(false);
	let blockKind = $state<string | null>(null);

	function copySelection(): void {
		const text = window.getSelection()?.toString() ?? '';
		if (text) void navigator.clipboard.writeText(text);
		placement = null;
	}

	interface Placement {
		x: number;
		y: number;
		/** The selection's first rect, for the flip above when there is no room below. */
		flipY: number;
	}

	// Only the host knows where its own fixed chrome ends, so the clearance floor arrives as a
	// prop rather than a viewport guess.
	let { editor, topInset = 0 }: { editor: EditorInstance | undefined; topInset?: number } =
		$props();

	let placement = $state<Placement | null>(null);
	let declined = $state<ReadonlySet<string>>(new Set());
	let active = $state<ReadonlySet<string>>(new Set());
	let current: EditorSelection | null = null;
	let barEl: HTMLDivElement | undefined = $state();

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
		if (x + size.w > window.innerWidth - margin) x = Math.max(margin, window.innerWidth - margin - size.w);
		if (y + size.h > window.innerHeight - margin) y = Math.max(topInset + 4, placement.flipY - size.h - BAR_GAP);
		return { x, y };
	});

	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', update);
	});

	// Only once the drag is over: a bar that appears and re-seats under a moving pointer is in the
	// way of the very selection being made. The press is watched at the document, since the drag
	// can end anywhere; the release places the bar from the selection that stood at that moment.
	let pointerHeld = false;
	$effect(() => {
		const down = (e: PointerEvent) => {
			if (e.button === 0) pointerHeld = true;
		};
		const up = () => {
			if (!pointerHeld) return;
			pointerHeld = false;
			update(current);
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
	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('menuChange', (open) => {
			menuOpen = open;
			if (open) placement = null;
			else if (current) update(current);
		});
	});

	// Sticky with the text: the rects are viewport coordinates, so a scroll or resize moves the
	// selection under the bar and the bar re-measures. One frame per burst, not one per event.
	$effect(() => {
		let frame = 0;
		const reanchor = () => {
			if (frame || !current) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				// Same gates as a selection change: a scroll mid-drag (autoscroll included) must not
				// bring the bar out before the release does.
				placement = current && !pointerHeld && !menuOpen ? place(current) : null;
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
		turnIntoOpen = false;
		blockKind = selection
			? (editor?.getBlockKindAt(normalizeSelection(selection).start.path) ?? null)
			: null;
		// Prose only: over a code fence or an equation's source the marks mean nothing, so the bar
		// stays away rather than opening greyed out.
		placement =
			selection && !menuOpen && !pointerHeld && blockKind !== null && PROSE_KINDS.has(blockKind)
				? place(selection)
				: null;
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
			// The bar hangs off where the selection ENDS, so the end block's rects come first. A
			// selection that starts at the very end of one block (a drag that left the block
			// upward, or began at the previous paragraph's end) leaves the start block's remaining
			// range empty, so that read is a fallback, and the start block's whole box the last one.
			const rects = editor!.getRects();
			const endRects =
				editor!.getBlockKindAt(end.path) !== 'table' && end.offset > 0
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
		if (editor!.getBlockKindAt(start.path) === 'table') return null;
		if (start.offset === end.offset) return null;
		const rects = editor!.getRects().rangeRects(start.path, start.offset, end.offset);
		return rects.length ? belowRight(rects) : null;
	}

	/** The bar opens like a menu: below the selection's last line and to the right of where it
	 *  ends, never over the text. The clamp above pushes it left at the viewport edge and flips it
	 *  above the first line when there is no room below. */
	const BAR_GAP = 6;

	function belowRight(rects: DOMRect[]): Placement | null {
		const first = rects[0];
		const last = rects[rects.length - 1];
		// Scrolled out from under the host's chrome or off the bottom: nothing to anchor to.
		if (last.bottom < topInset || first.top > window.innerHeight) return null;
		return { x: last.right + BAR_GAP, y: last.bottom + BAR_GAP, flipY: first.top };
	}

	// The id, not a synthesized chord: a host rebind moves the shortcut and leaves the button. A
	// declined run means the bar's premise went stale under it, so the boolean hides the bar.
	function fire(command: string, arg?: unknown): void {
		turnIntoOpen = false;
		if (editor && !editor.runCommand(command, arg)) placement = null;
	}
</script>

{#if shown}
	<div
		bind:this={barEl}
		class="selection-toolbar"
		data-testid="selection-toolbar"
		style:left="{shown.x}px"
		style:top="{shown.y}px"
		style:--bar-button="{BAR_BUTTON}px"
		role="toolbar"
		aria-label="Selection formatting"
		tabindex="-1"
		onpointerleave={() => (turnIntoOpen = false)}
	>
		<div class="toolbar-marks">
			{#each MARKS as button (button.command)}
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
					<MenuIcon name={button.icon} size={button.size} />
				</button>
			{/each}
		</div>
		<div class="toolbar-divider" aria-hidden="true"></div>
		<div
			class="toolbar-flyout-host"
			role="presentation"
			onpointerenter={() => (turnIntoOpen = !declined.has(TURN_INTO_COMMAND))}
		>
			<button
				type="button"
				class="toolbar-row"
				data-testid="toolbar-set-heading"
				disabled={declined.has(TURN_INTO_COMMAND)}
				aria-haspopup="menu"
				aria-expanded={turnIntoOpen}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => (turnIntoOpen = !turnIntoOpen)}
			>
				<span class="toolbar-row-icon"><MenuIcon name="heading" size={14} /></span>
				<span class="toolbar-row-label">Set heading</span>
				<span class="toolbar-row-icon"><MenuIcon name="chevron-right" size={13} /></span>
			</button>
			{#if turnIntoOpen}
				<div class="toolbar-flyout" role="menu">
					{#each TURN_INTO as option (option.level)}
						{@const current = option.level === 0 ? blockKind === 'paragraph' : false}
						<button
							type="button"
							class="toolbar-row"
							role="menuitemradio"
							data-testid="toolbar-set-heading-{option.level}"
							aria-checked={current}
							onmousedown={(e) => e.preventDefault()}
							onclick={() => fire(TURN_INTO_COMMAND, option.level)}
						>
							<span class="toolbar-row-label">{option.label}</span>
							{#if current}<span class="toolbar-row-icon"><MenuIcon name="check" size={13} /></span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#each ROWS as row (row.command)}
			<button
				type="button"
				class="toolbar-row"
				data-testid="toolbar-{row.command}"
				disabled={declined.has(row.command)}
				aria-pressed={active.has(row.command)}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => fire(row.command)}
			>
				<span class="toolbar-row-icon"><MenuIcon name={row.icon} size={14} /></span>
				<span class="toolbar-row-label">{row.label}</span>
				{#if active.has(row.command)}<span class="toolbar-row-icon"><MenuIcon name="check" size={13} /></span>{/if}
			</button>
		{/each}
		<button
			type="button"
			class="toolbar-row"
			data-testid="toolbar-copy"
			onmousedown={(e) => e.preventDefault()}
			onclick={copySelection}
		>
			<span class="toolbar-row-icon"><MenuIcon name="copy" size={14} /></span>
			<span>Copy</span>
		</button>
	</div>
{/if}

<style>
	/* limestone's menu surface, in Notion's popover shape: marks across the top, rows below. */
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		flex-direction: column;
		/* The bar sets the width: four buttons, three gaps, the padding. Rows fit inside it. */
		width: calc(4 * var(--bar-button) + 3 * 2px + 2 * 4px);
		box-sizing: border-box;
		padding: 4px;
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 8px;
		background: var(--color-bg, #2c2c2a);
		color: var(--color-text-primary, #e8e8e5);
		font-family: var(--font-ui, system-ui, sans-serif);
		font-size: 13px;
		line-height: 1.4;
		white-space: nowrap;
		box-shadow: var(--menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.3));
	}
	.toolbar-marks {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
	}
	.toolbar-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--bar-button);
		height: 30px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted, #8f8f89);
		cursor: pointer;
	}
	.toolbar-btn:hover:not(:disabled),
	.toolbar-btn[aria-pressed='true'] {
		color: var(--color-text-primary, #e8e8e5);
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
	}
	.toolbar-divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border, #3e3e3b);
	}
	.toolbar-row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.toolbar-row:hover:not(:disabled) {
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
	}
	.toolbar-row-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-ui-muted, #8f8f89);
	}
	.toolbar-row-label {
		flex: 1;
	}
	/* limestone's submenu: a second surface hung off the row's right edge. */
	.toolbar-flyout-host {
		position: relative;
	}
	.toolbar-row {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* limestone's submenu: a second surface hung off the row's right edge. */
	.toolbar-flyout {
		position: absolute;
		left: 100%;
		top: -4px;
		margin-left: 4px;
		min-width: 150px;
		padding: 4px;
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 8px;
		background: var(--color-bg, #2c2c2a);
		box-shadow: var(--menu-shadow, 0 8px 24px rgba(0, 0, 0, 0.3));
	}
	.toolbar-btn:disabled,
	.toolbar-row:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>