<script lang="ts">
	/**
	 * The block picker: what the bottom `+` and a right-click on prose open. Each row inserts a
	 * Markdown snippet at the caret through the same door the host's toolbar uses, so a plugin's
	 * block is listed only while that plugin is installed. Pointer- and keyboard-driven without
	 * ever taking focus: the caret the menu will insert at stays exactly where it is.
	 */
	import { isPluginInstalled } from '../../schema/plugin-install';
	import { clampMenuToViewport } from '../blocks/table/table-menu-model';
	import { BLOCK_MENU_LABEL } from '../../a11y-strings';
	import MenuIcon, { type MenuIconName } from './MenuIcon.svelte';

	interface BlockMenuItem {
		id: string;
		label: string;
		icon: MenuIconName;
		md: string;
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

	let {
		x,
		y,
		anchor,
		onPick,
		onClose
	}: {
		x: number;
		y: number;
		/** Where the open point is NOW, re-read on scroll and resize so the menu stays on it. */
		anchor?: () => { x: number; y: number } | null;
		onPick: (md: string) => void;
		onClose: () => void;
	} = $props();

	const items = $derived([
		...BUILT_IN,
		...FROM_PLUGINS.filter((entry) => isPluginInstalled(entry.plugin)).map((entry) => entry.item)
	]);

	let menuEl: HTMLDivElement | undefined = $state();
	let activeIndex = $state(0);

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
			switch (e.key) {
				case 'Escape':
					claim(e);
					onClose();
					return;
				case 'ArrowDown':
				case 'ArrowUp': {
					claim(e);
					const n = items.length;
					activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
					return;
				}
				case 'Enter':
					claim(e);
					onPick(items[activeIndex].md);
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
	aria-label={BLOCK_MENU_LABEL}
	style:left="{left}px"
	style:top="{top}px"
>
	{#each items as item, i (item.id)}
		<button
			type="button"
			role="menuitem"
			tabindex="-1"
			class="md-menu-item block-menu-item"
			data-active={i === activeIndex ? 'true' : undefined}
			data-testid="block-menu-{item.id}"
			onmousedown={(e) => e.preventDefault()}
			onpointerenter={() => (activeIndex = i)}
			onclick={() => onPick(item.md)}
		>
			<span class="md-menu-icon"><MenuIcon name={item.icon} /></span>
			<span>{item.label}</span>
		</button>
	{/each}
</div>

<style>
	/* Surface and rows are the shared `.md-menu` family (editor.css). */
	.block-menu {
		min-width: 188px;
	}
</style>
