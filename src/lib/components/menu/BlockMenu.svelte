<script lang="ts" module>
	/**
	 * A limestone-styled list menu the editor opens at a point: a block's context menu (rows run
	 * that kind's registered actions) and the prose menu's clipboard rows with its "Insert block"
	 * flyout (rows insert Markdown into a new paragraph). Pointer- and keyboard-driven without
	 * ever taking focus, so the caret it acts on stays exactly where it is.
	 */
	import type { MenuIconName } from '../../menu-icons';

	export interface MenuEntry {
		id: string;
		label: string;
		icon?: MenuIconName;
		danger?: boolean;
		disabled?: boolean;
		/** A separator row; nothing else on the entry is read. */
		divider?: boolean;
		/** A flyout: hover or ArrowRight opens these beside the row; a pick is one of their ids. */
		children?: MenuEntry[];
	}
</script>

<script lang="ts">
	import { clampMenuToViewport } from '../blocks/table/table-menu-model';
	import { BLOCK_MENU_LABEL } from '../../a11y-strings';
	import { keepFlyoutOnScreen } from './flyout-placement';
	import MenuIcon from './MenuIcon.svelte';
	import type { MenuPresence } from './menu-presence.svelte';

	let {
		x,
		y,
		anchor,
		items,
		label = BLOCK_MENU_LABEL,
		onPick,
		onClose,
		menuPresence
	}: {
		x: number;
		y: number;
		/** Where the open point is now, re-read on scroll and resize so the menu stays on it. */
		anchor?: () => { x: number; y: number } | null;
		items: MenuEntry[];
		label?: string;
		onPick: (id: string) => void;
		onClose: () => void;
		menuPresence: MenuPresence;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();
	let activeIndex = $state(0);
	/** The open flyout: the index of its parent row, and the active child inside it. */
	let flyout = $state<{ row: number; child: number } | null>(null);
	const selectable = $derived(items.map((item, i) => (item.divider || item.disabled ? -1 : i)));
	function step(from: number, delta: number): number {
		const n = items.length;
		let i = from;
		for (let k = 0; k < n; k++) {
			i = (i + delta + n) % n;
			if (selectable[i] !== -1) return i;
		}
		return from;
	}
	function pick(entry: MenuEntry): void {
		if (entry.disabled || entry.divider) return;
		if (entry.children) {
			flyout = { row: items.indexOf(entry), child: 0 };
			return;
		}
		onPick(entry.id);
	}

	// Positioned like the table's menu: follows the content, clamped once when first sized.
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

	// Keys are read at the document in the capture phase: the block with the caret keeps focus,
	// and the menu answers first while it is open. Anything it ignores reaches the editor.
	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
			onClose();
		};
		// Keys the menu takes stop here: the block with the caret would otherwise get the same
		// keystroke (an Enter splitting the block the menu is about to insert into).
		const claim = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.altKey || e.ctrlKey || e.metaKey) return;
			const open = flyout;
			const children = open ? (items[open.row].children ?? []) : [];
			switch (e.key) {
				case 'Escape':
					claim(e);
					if (open) flyout = null;
					else onClose();
					return;
				case 'ArrowDown':
				case 'ArrowUp': {
					claim(e);
					const delta = e.key === 'ArrowDown' ? 1 : -1;
					if (open)
						flyout = { ...open, child: (open.child + delta + children.length) % children.length };
					else activeIndex = step(activeIndex, delta);
					return;
				}
				case 'ArrowRight':
					if (items[activeIndex]?.children) {
						claim(e);
						flyout = { row: activeIndex, child: 0 };
					}
					return;
				case 'ArrowLeft':
					if (open) {
						claim(e);
						flyout = null;
					}
					return;
				case 'Enter':
					claim(e);
					if (open) onPick(children[open.child].id);
					else pick(items[activeIndex]);
					return;
			}
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});
</script>

<div
	bind:this={menuEl}
	class="md-menu block-menu"
	role="menu"
	aria-label={label}
	{@attach menuPresence.track}
	style:left="{left}px"
	style:top="{top}px"
>
	{#each items as item, i (item.id)}
		{#if item.divider}
			<div class="md-menu-divider" role="separator"></div>
		{:else}
			<div class="block-menu-row" role="presentation">
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					class="md-menu-item block-menu-item"
					class:block-menu-danger={item.danger}
					disabled={item.disabled}
					data-active={i === activeIndex ? 'true' : undefined}
					data-testid="block-menu-{item.id}"
					aria-haspopup={item.children ? 'menu' : undefined}
					aria-expanded={item.children ? flyout?.row === i : undefined}
					onmousedown={(e) => e.preventDefault()}
					onpointerenter={() => {
						activeIndex = i;
						flyout = item.children ? { row: i, child: 0 } : null;
					}}
					onclick={() => pick(item)}
				>
					{#if item.icon}<span class="md-menu-icon"><MenuIcon name={item.icon} /></span>{/if}
					<span class="block-menu-label">{item.label}</span>
					{#if item.children}<span class="md-menu-icon"
							><MenuIcon name="chevron-right" size={13} /></span
						>{/if}
				</button>
				{#if item.children && flyout?.row === i}
					<div
						class="md-menu block-menu block-menu-flyout"
						role="menu"
						{@attach keepFlyoutOnScreen}
						{@attach menuPresence.track}
					>
						{#each item.children as child, j (child.id)}
							<button
								type="button"
								role="menuitem"
								tabindex="-1"
								class="md-menu-item block-menu-item"
								data-active={flyout.child === j ? 'true' : undefined}
								data-testid="block-menu-{child.id}"
								onmousedown={(e) => e.preventDefault()}
								onpointerenter={() => (flyout = { row: i, child: j })}
								onclick={() => onPick(child.id)}
							>
								{#if child.icon}<span class="md-menu-icon"><MenuIcon name={child.icon} /></span
									>{/if}
								<span class="block-menu-label">{child.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	/* The panel and its rows are the shared `.md-menu` family (editor.css). */
	.block-menu {
		min-width: 188px;
	}
	.block-menu-row {
		position: relative;
	}
	.block-menu-label {
		flex: 1;
	}
	/* limestone's submenu: a second panel hung off the row's right edge. */
	.block-menu-flyout {
		position: absolute;
		left: 100%;
		top: -4px;
		margin-left: 4px;
	}
	.block-menu-danger,
	.block-menu-danger .md-menu-icon {
		color: var(--color-error, #d03025);
	}
</style>
