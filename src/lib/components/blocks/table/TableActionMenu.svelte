<script lang="ts">
	import {
		clampMenuToViewport,
		type TableMenuItem,
		type ClipboardAction
	} from './table-menu-model';
	import type { TableAxisAction } from '../../../action-contracts';
	import {
		ALIGN_CENTER,
		ALIGN_LEFT,
		ALIGN_RIGHT,
		COLUMN_ALIGNMENT,
		TABLE_ACTIONS
	} from '../../../a11y-strings';
	import MenuIcon, { type MenuIconName } from '../../menu/MenuIcon.svelte';
	import { tick, untrack } from 'svelte';

	// The glyph each entry carries, limestone's context-menu convention: an icon slot per row,
	// the destructive rows in the accent.
	const ICONS: Record<TableAxisAction | ClipboardAction, MenuIconName> = {
		insertRowAbove: 'plus',
		insertRowBelow: 'plus',
		insertColumnLeft: 'plus',
		insertColumnRight: 'plus',
		moveRowUp: 'arrow-up',
		moveRowDown: 'arrow-down',
		moveColumnLeft: 'arrow-left',
		moveColumnRight: 'arrow-right',
		deleteRow: 'trash',
		deleteColumn: 'trash',
		cycleAlignment: 'align-left',
		cut: 'scissors',
		copy: 'copy',
		paste: 'clipboard'
	};

	let {
		items,
		x,
		y,
		onaction,
		onclipboard,
		onalign,
		onclose,
		onescape,
		anchor
	}: {
		items: TableMenuItem[];
		x: number;
		y: number;
		/** Where the open point is NOW, re-read on scroll and resize so the menu stays on it. */
		anchor?: () => { x: number; y: number } | null;
		onaction: (action: TableAxisAction, index: number) => void;
		onclipboard: (action: ClipboardAction) => void;
		onalign: (alignment: 'left' | 'center' | 'right') => void;
		onclose: () => void;
		onescape: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();
	/** The open flyout, if any: hover or ArrowRight on its row opens it, ArrowLeft closes it. */
	let openGroup = $state<'row' | 'column' | null>(null);

	// The open point, viewport coordinates, re-read on scroll and resize so the menu stays on
	// what it opened on and leaves the viewport with it — never re-clamped into view, which
	// would float it over unrelated content. The clamp runs once, when the size is first known,
	// and its shift rides along as a constant offset.
	// svelte-ignore state_referenced_locally
	let at = $state({ x, y });
	let shift = $state<{ x: number; y: number } | null>(null);
	$effect(() => {
		const follow = () => {
			const next = anchor?.();
			if (next) at = next;
		};
		window.addEventListener('scroll', follow, { capture: true, passive: true });
		window.addEventListener('resize', follow, { passive: true });
		return () => {
			window.removeEventListener('scroll', follow, { capture: true });
			window.removeEventListener('resize', follow);
		};
	});
	$effect(() => {
		if (!menuEl || shift) return;
		const rect = menuEl.getBoundingClientRect();
		const clamped = clampMenuToViewport(
			{ x, y },
			{ width: rect.width, height: rect.height },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		shift = { x: clamped.x - x, y: clamped.y - y };
	});
	const left = $derived(at.x + (shift?.x ?? 0));
	const top = $derived(at.y + (shift?.y ?? 0));

	// The first enabled item is the keyboard entry point; disabled items are never stops.
	// Untracked: `focusStop` reads the open flyout, and a tracked read here would re-run this
	// mount-time landing every time a flyout opened, pulling focus straight back out of it.
	$effect(() => {
		if (menuEl) untrack(() => focusStop(0));
	});

	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
			onclose();
		};
		// Document-level so Escape closes even if focus drifted off a stop. Escape restores
		// focus to the originating cell; an outside click deliberately does not.
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onescape();
			}
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	// ── Roving focus (ARIA menu pattern) ────────────────────────────────────
	//
	// Up/Down (and Tab, trapped) step every enabled item and alignment segment; Left/Right
	// hop within the alignment trio. Enter/Space fall through to native button activation.

	function focusableStops(): HTMLElement[] {
		if (!menuEl) return [];
		return Array.from(
			menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), .alignment-segment')
		);
	}

	function focusStop(index: number): void {
		const stops = focusableStops();
		if (stops.length === 0) return;
		const n = stops.length;
		const stop = stops[((index % n) + n) % n];
		stop.focus();
		// Focus that leaves an open flyout (and its own row) closes it, so the list reads as one.
		if (openGroup && !stop.closest('.table-action-menu-flyout') && stop.dataset.group !== openGroup) {
			openGroup = null;
		}
	}

	/** Open a group's flyout and land on its first enabled item. */
	function openFlyout(id: 'row' | 'column'): void {
		openGroup = id;
		void tick().then(() => {
			const first = menuEl?.querySelector<HTMLElement>(
				'.table-action-menu-flyout [role="menuitem"]:not([disabled])'
			);
			first?.focus();
		});
	}

	function activeStopIndex(stops: HTMLElement[]): number {
		return document.activeElement instanceof HTMLElement
			? stops.indexOf(document.activeElement)
			: -1;
	}

	function onMenuKeyDown(e: KeyboardEvent): void {
		const stops = focusableStops();
		if (stops.length === 0) return;
		const current = activeStopIndex(stops);
		const last = stops.length - 1;
		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp':
			case 'Tab': {
				e.preventDefault();
				const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
				focusStop(current === -1 ? (back ? last : 0) : current + (back ? -1 : 1));
				return;
			}
			case 'Home':
				e.preventDefault();
				focusStop(0);
				return;
			case 'End':
				e.preventDefault();
				focusStop(last);
				return;
			case 'ArrowRight': {
				const group = (document.activeElement as HTMLElement | null)?.dataset.group;
				if (group === 'row' || group === 'column') {
					e.preventDefault();
					openFlyout(group);
					return;
				}
				moveWithinAlignment(e);
				return;
			}
			case 'ArrowLeft': {
				const inFlyout = (document.activeElement as HTMLElement | null)?.closest(
					'.table-action-menu-flyout'
				);
				if (inFlyout && openGroup) {
					e.preventDefault();
					const row = menuEl?.querySelector<HTMLElement>(`[data-group="${openGroup}"]`);
					openGroup = null;
					row?.focus();
					return;
				}
				moveWithinAlignment(e);
				return;
			}
		}
	}

	function moveWithinAlignment(e: KeyboardEvent): void {
		if (!menuEl) return;
		const segments = Array.from(menuEl.querySelectorAll<HTMLElement>('.alignment-segment'));
		const i =
			document.activeElement instanceof HTMLElement ? segments.indexOf(document.activeElement) : -1;
		if (i === -1) return;
		e.preventDefault();
		const n = segments.length;
		const delta = e.key === 'ArrowRight' ? 1 : -1;
		segments[(((i + delta) % n) + n) % n].focus();
	}

	// The actions that live inside a flyout: hovering one keeps its flyout open; hovering a
	// top-level row closes whichever flyout is open.
	const GROUPED = new Set<TableAxisAction>([
		'insertRowAbove',
		'insertRowBelow',
		'moveRowUp',
		'moveRowDown',
		'insertColumnLeft',
		'insertColumnRight',
		'moveColumnLeft',
		'moveColumnRight'
	]);
	const isGrouped = (action: TableAxisAction): boolean => GROUPED.has(action);

	// 'none' renders identically to 'left', so the left segment reads active for both.
	// The glyph is the visible label; the accessible name carries the full word.
	const alignmentSegments = [
		{ value: 'left', icon: 'align-left', name: ALIGN_LEFT },
		{ value: 'center', icon: 'align-center', name: ALIGN_CENTER },
		{ value: 'right', icon: 'align-right', name: ALIGN_RIGHT }
	] as const;
</script>

<div
	bind:this={menuEl}
	class="md-menu table-action-menu"
	role="menu"
	aria-label={TABLE_ACTIONS}
	tabindex="-1"
	style:left="{left}px"
	style:top="{top}px"
	onkeydown={onMenuKeyDown}
>
	{#each items as item, i (i)}
		{#if item.kind === 'action' || item.kind === 'clipboard'}
			{@render actionRow(item)}
		{:else if item.kind === 'group'}
			<div class="table-action-menu-group" role="presentation">
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					class="md-menu-item table-action-menu-item"
					data-group={item.id}
					aria-haspopup="menu"
					aria-expanded={openGroup === item.id}
					onpointerenter={() => (openGroup = item.id)}
					onclick={() => openFlyout(item.id)}
				>
					<span class="md-menu-icon"
						><MenuIcon name={item.id === 'row' ? 'rows-2' : 'columns-2'} /></span
					>
					<span class="table-action-menu-label">{item.label}</span>
					<span class="md-menu-icon"><MenuIcon name="chevron-right" size={13} /></span>
				</button>
				{#if openGroup === item.id}
					<div class="md-menu table-action-menu-flyout" role="menu" aria-label={item.label}>
						{#each item.items as sub, j (j)}
							{#if sub.kind === 'action' || sub.kind === 'clipboard'}
								{@render actionRow(sub)}
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{:else if item.kind === 'separator'}
			<div class="md-menu-divider table-action-menu-separator" role="separator"></div>
		{:else}
			<div class="table-action-menu-alignment" role="group" aria-label={COLUMN_ALIGNMENT}>
				{#each alignmentSegments as seg (seg.value)}
					{@const active =
						item.current === seg.value || (seg.value === 'left' && item.current === 'none')}
					<button
						type="button"
						class="alignment-segment"
						class:active
						tabindex="-1"
						aria-label={seg.name}
						aria-pressed={active}
						title={seg.name}
						onclick={() => onalign(seg.value)}><MenuIcon name={seg.icon} /></button
					>
				{/each}
			</div>
		{/if}
	{/each}
</div>

{#snippet actionRow(item: Extract<TableMenuItem, { kind: 'action' | 'clipboard' }>)}
	{@const activate =
		item.kind === 'action'
			? () => onaction(item.action, item.index)
			: () => onclipboard(item.action)}
	<button
		type="button"
		role="menuitem"
		tabindex="-1"
		class="md-menu-item table-action-menu-item"
		disabled={!item.enabled}
		aria-disabled={!item.enabled}
		onpointerenter={() => {
			if (!(item.kind === 'action' && isGrouped(item.action))) openGroup = null;
		}}
		onclick={activate}
	>
		<span class="md-menu-icon"><MenuIcon name={ICONS[item.action]} /></span>
		<span class="table-action-menu-label">{item.label}</span>
	</button>
{/snippet}

<style>
	/* The surface, rows, icons and dividers are the shared `.md-menu` family (editor.css); only
	   the alignment trio is this menu's own — three glyph buttons on one row, the active one
	   lifted like a hover. */
	.table-action-menu-alignment {
		display: flex;
		gap: 2px;
		padding: 4px 6px;
	}
	.table-action-menu-label {
		flex: 1;
	}
	.table-action-menu-group {
		position: relative;
	}
	/* limestone's submenu: a second surface hung off the row's right edge. */
	.table-action-menu-flyout {
		position: absolute;
		left: 100%;
		top: -4px;
		margin-left: 4px;
		white-space: nowrap;
	}
	.alignment-segment {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted, #8f8f89);
		cursor: pointer;
	}
	.alignment-segment:hover,
	.alignment-segment:focus-visible,
	.alignment-segment.active {
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
		outline: none;
	}
	.alignment-segment.active {
		color: var(--color-text-primary, #e8e8e5);
	}
</style>