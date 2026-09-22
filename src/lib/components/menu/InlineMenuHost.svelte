<script lang="ts">
	import { tick } from 'svelte';
	import { INLINE_MENU_LABEL } from '../../a11y-strings';
	import type { EditorEvents } from '../../editor-events';
	import type { InlineMenuState } from '../../inline-menu/inline-menu-state.svelte';
	import { eventToChord } from '../../schema/keybindings';

	// Mounted unconditionally by Editor: the key claim and the anchoring must observe the session
	// opening, so the open/closed `{#if}` lives here rather than at the mount site.
	let {
		menu,
		events,
		getEditorEl,
		measureRange
	}: {
		menu: InlineMenuState;
		events: EditorEvents;
		getEditorEl: () => HTMLElement | null;
		measureRange: (path: number[], start: number, end: number) => DOMRect[];
	} = $props();

	const GAP_PX = 4;
	const EDGE_PX = 8;

	let menuEl: HTMLDivElement | undefined = $state();
	let position = $state<{ left: number; top: number } | null>(null);

	const view = $derived(menu.getOpen());
	// An empty list paints nothing and holds no key: Enter after `#zzz` is the author's own Enter.
	const showing = $derived(view !== null && view.items.length > 0);

	/** Under the trigger's first glyph, or above it where the viewport leaves no room below. */
	function place(): void {
		const open = menu.getOpen();
		if (!open || !menuEl) return;
		const rect = measureRange(open.path, open.start, open.end)[0];
		if (!rect) return;
		const { width, height } = menuEl.getBoundingClientRect();
		const below = rect.bottom + GAP_PX;
		const fitsBelow = below + height <= window.innerHeight - EDGE_PX;
		const top = fitsBelow ? below : Math.max(EDGE_PX, rect.top - GAP_PX - height);
		const left = Math.max(EDGE_PX, Math.min(rect.left, window.innerWidth - EDGE_PX - width));
		position = { left, top };
	}

	$effect(() => {
		if (!showing) {
			position = null;
			return;
		}
		// Every read that moves the anchor or resizes the list re-places it.
		void view?.end;
		void view?.items;
		place();
		// An `edit` publishes the bytes before the leaf has re-rendered them; the rects are the
		// new ones a tick later.
		const unsubscribe = events.on('edit', () => void tick().then(place));
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			unsubscribe();
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
	});

	// The keys a list needs, taken at the root's capture phase so the focused block never sees
	// them: the caret stays in the document and the author keeps typing the query.
	$effect(() => {
		const root = getEditorEl();
		if (!showing || !root) return;
		const onKeyDown = (e: KeyboardEvent) => {
			// A composing Enter or Escape belongs to the IME's candidate window.
			if (e.isComposing) return;
			// The bare key alone: a chorded arrow (Shift to extend, Mod to jump) stays the document's.
			const chord = eventToChord(e);
			if (chord === 'ArrowDown') menu.move(1);
			else if (chord === 'ArrowUp') menu.move(-1);
			else if (chord === 'Enter' || chord === 'Tab') menu.commit();
			else if (chord === 'Escape') menu.close();
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		root.addEventListener('keydown', onKeyDown, true);
		return () => root.removeEventListener('keydown', onKeyDown, true);
	});

	// The baseline the first bytes in a leaf are read against, taken just before they land.
	// Every input route fires beforeinput (a keystroke, an IME commit, a paste, a script's
	// insertText); the caret's arrival is announced a task later and can lose the race to them.
	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		const onBeforeInput = () => menu.primeBaseline();
		root.addEventListener('beforeinput', onBeforeInput, true);
		return () => root.removeEventListener('beforeinput', onBeforeInput, true);
	});

	// Focus leaving the editor ends the session; the list itself never takes focus.
	$effect(() => {
		const root = getEditorEl();
		if (view === null || !root) return;
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
			if (!next || !root.contains(next)) menu.close();
		};
		root.addEventListener('focusout', onFocusOut);
		return () => root.removeEventListener('focusout', onFocusOut);
	});

	$effect(() => {
		void view?.activeIndex;
		menuEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#if showing && view}
	{@const Row = view.source.row}
	<!-- A press on the list must not blur the document: the block under the caret commits on blur,
	     and the pick needs that caret. -->
	<div
		bind:this={menuEl}
		id={menu.listboxId}
		class="md-menu inline-menu"
		role="listbox"
		tabindex="-1"
		aria-label={INLINE_MENU_LABEL}
		data-inline-menu={view.source.name}
		style:left="{position?.left ?? 0}px"
		style:top="{position?.top ?? 0}px"
		style:visibility={position ? 'visible' : 'hidden'}
		onpointerdown={(e) => e.preventDefault()}
	>
		{#each view.items as item, i (item.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				id={menu.optionId(item.id)}
				class="md-menu-item inline-menu-item"
				role="option"
				tabindex="-1"
				aria-selected={i === view.activeIndex}
				data-active={i === view.activeIndex}
				onpointermove={() => menu.setActive(i)}
				onclick={() => menu.commit(i)}
			>
				{#if Row}
					<Row {item} active={i === view.activeIndex} query={view.query} />
				{:else}
					<span class="inline-menu-label">{item.label}</span>
					{#if item.detail}<span class="inline-menu-detail">{item.detail}</span>{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	/* Surface and rows are the shared `.md-menu` family (editor.css). */
	.inline-menu {
		max-width: 360px;
		max-height: 264px;
		overflow-y: auto;
	}

	.inline-menu-label {
		flex: 1 1 auto;
		min-width: 4em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* No percentage width: the list sizes to its content, and a percentage there resolves
	   against a width the content is still deciding, which clips a detail that would fit. */
	.inline-menu-detail {
		flex: 0 1 auto;
		min-width: 0;
		margin-left: auto;
		padding-left: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-ui-muted, #8f8f89);
	}
</style>
