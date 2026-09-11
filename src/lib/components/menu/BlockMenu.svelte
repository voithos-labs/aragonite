<script lang="ts" module>
	/**
	 * A limestone-styled list menu the editor opens at a point: the block picker behind the
	 * bottom `+` (rows insert Markdown at the caret) and a block's context menu (rows run that
	 * kind's registered actions). Pointer- and keyboard-driven without ever taking focus, so the
	 * caret it acts on stays exactly where it is.
	 */
	import { isPluginInstalled } from '../../schema/plugin-install';
	import type { MenuIconName } from './MenuIcon.svelte';

	interface BlockMenuItem {
		id: string;
		label: string;
		icon: MenuIconName;
		md: string;
	}

	export interface MenuEntry {
		id: string;
		label: string;
		icon?: MenuIconName;
		danger?: boolean;
		disabled?: boolean;
		/** A separator row; nothing else on the entry is read. */
		divider?: boolean;
		/** A flyout: hover or ArrowRight opens these beside the row; a pick is one of THEIR ids. */
		children?: MenuEntry[];
	}

	// Blocks that stand on their own when empty. A heading is not one — it is text turned into a
	// heading, which the selection popover offers — so it is deliberately not here.
	const BUILT_IN: readonly BlockMenuItem[] = [
		{ id: 'bullet', label: 'Bulleted list', icon: 'list', md: '- ' },
		{ id: 'numbered', label: 'Numbered list', icon: 'list-ordered', md: '1. ' },
		{ id: 'todo', label: 'To-do list', icon: 'square-check', md: '- [ ] ' },
		{ id: 'quote', label: 'Quote', icon: 'text-quote', md: '> ' },
		{ id: 'divider', label: 'Divider', icon: 'minus', md: '---\n' },
		{ id: 'code', label: 'Code block', icon: 'code', md: '```\n\n```\n' },
		{ id: 'table', label: 'Table', icon: 'table', md: '| Column | Column |\n| --- | --- |\n|  |  |\n' }
	];
	// Listed only while the plugin that reads the syntax is installed.
	const FROM_PLUGINS: readonly { plugin: string; item: BlockMenuItem }[] = [
		{ plugin: 'latex', item: { id: 'math', label: 'Math block', icon: 'sigma', md: '$$\n\n$$\n' } },
		{
			plugin: 'admonitions',
			item: { id: 'note', label: 'Note', icon: 'info', md: ':::note\n\n:::\n' }
		}
	];

	/** Every insertable block, keyed by id, for resolving a pick from either level of the menu. */
	export function insertSnippets(): Map<string, string> {
		const all = [
			...BUILT_IN,
			...FROM_PLUGINS.filter((entry) => isPluginInstalled(entry.plugin)).map((entry) => entry.item)
		];
		return new Map(all.map((item) => [item.id, item.md]));
	}

	/** Every insertable block as one flat list, for a flyout that is already a level down. */
	export function insertFlyoutEntries(): MenuEntry[] {
		return [
			...BUILT_IN,
			...FROM_PLUGINS.filter((entry) => isPluginInstalled(entry.plugin)).map((entry) => entry.item)
		].map(({ id, label, icon }) => ({ id, label, icon }));
	}

	const COMMON = new Set(['bullet', 'numbered', 'todo', 'code', 'table', 'math']);

	/** The insert menu: the common blocks, the rest behind "More blocks". */
	export function insertMenuEntries(): MenuEntry[] {
		const all = [
			...BUILT_IN,
			...FROM_PLUGINS.filter((entry) => isPluginInstalled(entry.plugin)).map((entry) => entry.item)
		];
		const row = ({ id, label, icon }: BlockMenuItem): MenuEntry => ({ id, label, icon });
		const common = all.filter((item) => COMMON.has(item.id)).map(row);
		const more = all.filter((item) => !COMMON.has(item.id)).map(row);
		return more.length
			? [...common, { id: 'more', label: 'More blocks', icon: 'plus', children: more }]
			: common;
	}
</script>

<script lang="ts">
	import { clampMenuToViewport } from '../blocks/table/table-menu-model';
	import { BLOCK_MENU_LABEL } from '../../a11y-strings';
	import { keepFlyoutOnScreen } from './flyout-placement';
	import MenuIcon from './MenuIcon.svelte';

	let {
		x,
		y,
		anchor,
		items,
		label = BLOCK_MENU_LABEL,
		onPick,
		onClose
	}: {
		x: number;
		y: number;
		/** Where the open point is NOW, re-read on scroll and resize so the menu stays on it. */
		anchor?: () => { x: number; y: number } | null;
		items: MenuEntry[];
		label?: string;
		onPick: (id: string) => void;
		onClose: () => void;
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

	// Same anchoring as the table's menu: follows the content, clamped once when first sized.
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

	// Keys are read at the document, capture phase: the caret's surface keeps focus, and the
	// menu answers first while it is open. Anything it does not claim reaches the editor as usual.
	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
			onClose();
		};
		// Claimed keys stop here: the caret's surface would otherwise take the same press (an
		// Enter splitting the block the menu is about to insert into).
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
					if (open) flyout = { ...open, child: (open.child + delta + children.length) % children.length };
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
					{#if item.children}<span class="md-menu-icon"><MenuIcon name="chevron-right" size={13} /></span>{/if}
				</button>
				{#if item.children && flyout?.row === i}
					<div class="md-menu block-menu block-menu-flyout" role="menu" {@attach keepFlyoutOnScreen}>
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
								{#if child.icon}<span class="md-menu-icon"><MenuIcon name={child.icon} /></span>{/if}
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
	/* Surface and rows are the shared `.md-menu` family (editor.css). */
	.block-menu {
		min-width: 188px;
	}
	.block-menu-row {
		position: relative;
	}
	.block-menu-label {
		flex: 1;
	}
	/* limestone's submenu: a second surface hung off the row's right edge. */
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
