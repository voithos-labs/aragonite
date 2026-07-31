<script lang="ts">
	import {
		clampMenuToViewport,
		type TableMenuItem,
		type ClipboardAction
	} from './table-menu-model';
	import type { TableAxisAction } from '../../../action-contracts';

	let {
		items,
		x,
		y,
		onaction,
		onclipboard,
		onalign,
		onclose,
		onescape
	}: {
		items: TableMenuItem[];
		x: number;
		y: number;
		onaction: (action: TableAxisAction, index: number) => void;
		onclipboard: (action: ClipboardAction) => void;
		onalign: (alignment: 'left' | 'center' | 'right') => void;
		onclose: () => void;
		onescape: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();

	// Resolved once the menu's measured size is known; until then the template falls back
	// to the raw open coordinate, which the post-mount measure corrects before it paints.
	let clamped = $state<{ x: number; y: number } | null>(null);
	$effect(() => {
		if (!menuEl) return;
		const rect = menuEl.getBoundingClientRect();
		clamped = clampMenuToViewport(
			{ x, y },
			{ width: rect.width, height: rect.height },
			{ width: window.innerWidth, height: window.innerHeight }
		);
	});

	// The first enabled item is the keyboard entry point; disabled items are never stops.
	$effect(() => {
		if (menuEl) focusStop(0);
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
		stops[((index % n) + n) % n].focus();
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
				e.preventDefault();
				focusStop(current === -1 ? 0 : current + 1);
				return;
			case 'ArrowUp':
				e.preventDefault();
				focusStop(current === -1 ? last : current - 1);
				return;
			case 'Home':
				e.preventDefault();
				focusStop(0);
				return;
			case 'End':
				e.preventDefault();
				focusStop(last);
				return;
			case 'Tab':
				e.preventDefault();
				if (e.shiftKey) focusStop(current === -1 ? last : current - 1);
				else focusStop(current === -1 ? 0 : current + 1);
				return;
			case 'ArrowRight':
			case 'ArrowLeft':
				moveWithinAlignment(e);
				return;
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

	// 'none' renders identically to 'left', so the left segment reads active for both.
	// Visible text stays L/C/R; the accessible name carries the full word.
	const alignmentSegments = [
		{ value: 'left', label: 'L', name: 'Left' },
		{ value: 'center', label: 'C', name: 'Center' },
		{ value: 'right', label: 'R', name: 'Right' }
	] as const;
</script>

<div
	bind:this={menuEl}
	class="table-action-menu"
	role="menu"
	aria-label="Table actions"
	tabindex="-1"
	style:left="{clamped ? clamped.x : x}px"
	style:top="{clamped ? clamped.y : y}px"
	onkeydown={onMenuKeyDown}
>
	{#each items as item, i (i)}
		{#if item.kind === 'action' || item.kind === 'clipboard'}
			{@const activate =
				item.kind === 'action'
					? () => onaction(item.action, item.index)
					: () => onclipboard(item.action)}
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				class="table-action-menu-item"
				disabled={!item.enabled}
				aria-disabled={!item.enabled}
				onclick={activate}
			>
				{item.label}
			</button>
		{:else if item.kind === 'separator'}
			<div class="table-action-menu-separator" role="separator"></div>
		{:else}
			<div class="table-action-menu-alignment" role="group" aria-label="Column alignment">
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
						onclick={() => onalign(seg.value)}>{seg.label}</button
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
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
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
		background: transparent;
		font: inherit;
		color: var(--color-ui-muted, #a4a4a4);
		cursor: pointer;
	}
	.alignment-segment:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
	}
	.alignment-segment.active {
		color: var(--color-accent, #567b67);
		border-color: var(--color-accent, #567b67);
	}
</style>
