<script lang="ts">
	import type { TableMenuItem, ClipboardAction } from './table-menu-model';
	import type { CellShortcutAction } from './cell-keydown-plan';

	let {
		items,
		x,
		y,
		onaction,
		onclipboard,
		onclose
	}: {
		items: TableMenuItem[];
		x: number;
		y: number;
		onaction: (action: CellShortcutAction, index: number) => void;
		onclipboard: (action: ClipboardAction) => void;
		onclose: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
			onclose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onclose();
			}
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	// 'none' renders identically to 'left' (see table-menu-model / alignment cycle),
	// so the left segment reads as active for both.
	const alignmentSegments = [
		{ value: 'left', label: 'L' },
		{ value: 'center', label: 'C' },
		{ value: 'right', label: 'R' }
	] as const;
</script>

<div bind:this={menuEl} class="table-action-menu" role="menu" style:left="{x}px" style:top="{y}px">
	{#each items as item}
		{#if item.kind === 'action'}
			<button
				type="button"
				role="menuitem"
				class="table-action-menu-item"
				disabled={!item.enabled}
				aria-disabled={!item.enabled}
				onclick={() => onaction(item.action, item.index)}
			>
				{item.label}
			</button>
		{:else if item.kind === 'clipboard'}
			<button
				type="button"
				role="menuitem"
				class="table-action-menu-item"
				disabled={!item.enabled}
				aria-disabled={!item.enabled}
				onclick={() => onclipboard(item.action)}
			>
				{item.label}
			</button>
		{:else if item.kind === 'separator'}
			<div class="table-action-menu-separator" role="separator"></div>
		{:else}
			<div class="table-action-menu-alignment" role="group" aria-label="Column alignment">
				{#each alignmentSegments as seg}
					<span
						class="alignment-segment"
						class:active={item.current === seg.value ||
							(seg.value === 'left' && item.current === 'none')}>{seg.label}</span
					>
				{/each}
			</div>
		{/if}
	{/each}
</div>

<style>
	.table-action-menu {
		position: fixed;
		z-index: 30;
		min-width: 11rem;
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
		font-size: 0.9em;
		user-select: none;
	}

	.table-action-menu-item {
		display: block;
		width: 100%;
		padding: 0.3rem 0.55rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.table-action-menu-item:hover:not(:disabled) {
		background: var(--color-ui-faint, rgba(100, 150, 255, 0.14));
	}
	.table-action-menu-item:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.table-action-menu-separator {
		height: 1px;
		margin: 0.25rem 0.3rem;
		background: var(--color-ui-muted, #a4a4a4);
		opacity: 0.5;
	}

	.table-action-menu-alignment {
		display: flex;
		gap: 0.2rem;
		padding: 0.3rem 0.55rem;
	}
	.alignment-segment {
		flex: 1;
		padding: 0.1rem 0;
		text-align: center;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		color: var(--color-ui-muted, #a4a4a4);
	}
	.alignment-segment.active {
		color: var(--color-accent, #567b67);
		border-color: var(--color-accent, #567b67);
	}
</style>
