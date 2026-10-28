<script lang="ts">
	import { imeOwnsKey } from '../browser/composition';
	import { getContext } from 'svelte';
	import { EDITOR_SERVICES_KEY, type EditorServices } from '../editor-keys';
	import { keepCornerControlsClear } from './corner-controls';
	import { POINTER_GESTURE_ATTR } from '../selection/pointer-gesture';
	import MenuIcon from './menu/MenuIcon.svelte';
	import {
		SEARCH_CLOSE_LABEL,
		SEARCH_CLOSE_TITLE,
		SEARCH_FIND,
		SEARCH_MATCH_CASE,
		SEARCH_NEXT_LABEL,
		SEARCH_NEXT_TITLE,
		SEARCH_PREVIOUS_LABEL,
		SEARCH_PREVIOUS_TITLE,
		SEARCH_REGEX,
		SEARCH_REPLACE,
		SEARCH_TOGGLE_REPLACE,
		SEARCH_WHOLE_WORD
	} from '../a11y-strings';

	// Editor owns `replaceExpanded`, so Ctrl+H and the replace toggle button share it; the button
	// reports each press back up.
	let {
		replaceExpanded = false,
		onToggleReplace,
		editorRoot
	}: {
		replaceExpanded?: boolean;
		onToggleReplace?: () => void;
		/** Where the blocks whose corner controls the open bar may cover are rendered. */
		editorRoot: () => HTMLElement | undefined;
	} = $props();

	const { search } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	const OPTION_TOGGLES = [
		{ key: 'caseSensitive', icon: 'case-sensitive', text: SEARCH_MATCH_CASE },
		{ key: 'wholeWord', icon: 'whole-word', text: SEARCH_WHOLE_WORD },
		{ key: 'regex', icon: 'regex', text: SEARCH_REGEX }
	] as const;

	let findInput = $state<HTMLInputElement>();
	$effect(() => {
		if (search.isOpen) findInput?.focus();
	});

	const fieldInRow = (el: Element) =>
		el.closest('.search-row')?.querySelector('input') ?? findInput;

	// The steps and the replace buttons disable once no match is left, and a disabled button
	// can't keep focus, so focus moves to the field in the same row.
	let barEl = $state<HTMLElement>();
	$effect(() => {
		if (search.matches.length || !barEl) return;
		const focused = barEl.ownerDocument.activeElement;
		if (focused instanceof HTMLButtonElement && focused.disabled && barEl.contains(focused)) {
			fieldInRow(focused)?.focus();
		}
	});

	// The card is the field, so a press on it that lands on no control types into its row's field.
	// The bar claims its presses, or the editor would read one as a click in the document under it.
	const ownPresses = { [POINTER_GESTURE_ATTR]: '' };
	function focusFieldOnBarePress(bar: HTMLElement) {
		const onMouseDown = (e: MouseEvent) => {
			if (!(e.target instanceof Element) || e.target.closest('button, input')) return;
			e.preventDefault();
			fieldInRow(e.target)?.focus();
		};
		bar.addEventListener('mousedown', onMouseDown);
		return () => bar.removeEventListener('mousedown', onMouseDown);
	}

	function onFindKeydown(e: KeyboardEvent) {
		if (imeOwnsKey(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.shiftKey ? search.prev() : search.next();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			search.close();
		}
	}

	function onReplaceKeydown(e: KeyboardEvent) {
		if (imeOwnsKey(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			search.replaceCurrent();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			search.close();
		}
	}
</script>

{#if search.isOpen}
	<div
		class="search-bar"
		class:invalid={!!search.error}
		role="search"
		bind:this={barEl}
		{...ownPresses}
		{@attach keepCornerControlsClear(editorRoot)}
		{@attach focusFieldOnBarePress}
	>
		<div class="search-row">
			<input
				bind:this={findInput}
				class="search-input"
				placeholder={SEARCH_FIND}
				value={search.query}
				oninput={(e) => search.setQuery(e.currentTarget.value)}
				onkeydown={onFindKeydown}
				aria-label={SEARCH_FIND}
			/>
			<span
				class="search-count"
				class:error={!!search.error}
				role="status"
				title={search.error ?? undefined}
				>{#if search.error}
					{search.error}
				{:else if !search.query}
					<!-- Nothing to count yet. -->
				{:else if search.isScanning}
					Searching…
				{:else if search.matches.length}
					{search.activeIndex + 1} of {search.matches.length}
				{:else if search.replacedCount != null}
					{search.replacedCount} replaced
				{:else}
					No results
				{/if}</span
			>
			<span class="search-controls">
				{#each OPTION_TOGGLES as toggle (toggle.key)}
					<button
						type="button"
						class="search-icon-btn search-tog"
						class:on={search.options[toggle.key]}
						title={toggle.text}
						aria-label={toggle.text}
						aria-pressed={search.options[toggle.key]}
						onclick={() => search.setOptions({ [toggle.key]: !search.options[toggle.key] })}
						><MenuIcon name={toggle.icon} size={15} /></button
					>
				{/each}
				<span class="search-gap" aria-hidden="true"></span>
				<button
					type="button"
					class="search-icon-btn"
					title={SEARCH_PREVIOUS_TITLE}
					aria-label={SEARCH_PREVIOUS_LABEL}
					disabled={!search.matches.length}
					onclick={() => search.prev()}><MenuIcon name="arrow-up" size={15} /></button
				>
				<button
					type="button"
					class="search-icon-btn"
					title={SEARCH_NEXT_TITLE}
					aria-label={SEARCH_NEXT_LABEL}
					disabled={!search.matches.length}
					onclick={() => search.next()}><MenuIcon name="arrow-down" size={15} /></button
				>
				<button
					type="button"
					class="search-icon-btn search-tog"
					class:on={replaceExpanded}
					title={SEARCH_TOGGLE_REPLACE}
					aria-label={SEARCH_TOGGLE_REPLACE}
					aria-expanded={replaceExpanded}
					onclick={() => onToggleReplace?.()}><MenuIcon name="replace" size={15} /></button
				>
				<button
					type="button"
					class="search-icon-btn"
					title={SEARCH_CLOSE_TITLE}
					aria-label={SEARCH_CLOSE_LABEL}
					onclick={() => search.close()}><MenuIcon name="x" size={15} /></button
				>
			</span>
		</div>
		{#if replaceExpanded}
			<div class="search-row search-replace-row">
				<input
					class="search-input"
					placeholder={SEARCH_REPLACE}
					value={search.replacement}
					oninput={(e) => search.setReplacement(e.currentTarget.value)}
					onkeydown={onReplaceKeydown}
					aria-label={SEARCH_REPLACE}
				/>
				<span class="search-controls">
					<button
						type="button"
						class="search-btn"
						disabled={!search.matches.length}
						onclick={() => search.replaceCurrent()}>Replace</button
					>
					<button
						type="button"
						class="search-btn"
						disabled={!search.matches.length}
						onclick={() => search.replaceAll()}>All</button
					>
				</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* A raised card that is itself the find field: no inner box, a soft ring while it holds focus,
	   and quiet icon buttons that fill only on hover. */
	.search-bar {
		position: absolute;
		/* The only placement knobs: the editor sets them at `.editor`, an anchor may set its own. */
		top: var(--search-bar-top, 10px);
		right: var(--search-bar-right, 10px);
		/* Pinned to the right edge, so without the cap a narrow host puts the bar's left half (the
		   find field) off screen instead of shrinking it. */
		max-width: calc(100% - 2 * var(--search-bar-right, 10px));
		/* A set width, not content-sized: the count appearing and changing length as you type
		   takes room from the field, rather than resizing the card under the pointer. */
		width: 400px;
		box-sizing: border-box;
		z-index: 5;
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		box-shadow: var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
		font-family: var(--font-ui, system-ui, sans-serif);
		font-size: 14px;
		line-height: 1.4;
		color: var(--color-text-primary);
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease;
	}
	/* The edge and a hairline outside it make a 2px ring in the muted text colour, which holds 3:1
	   against the card and the page in both themes. */
	.search-bar:focus-within {
		border-color: var(--color-ui-muted);
		box-shadow:
			0 0 0 1px var(--color-ui-muted),
			var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
	}
	/* A pattern the engine refused: the card's edge says so, the count says why. */
	.search-bar.invalid {
		border-color: var(--color-error);
	}
	.search-bar.invalid:focus-within {
		box-shadow:
			0 0 0 1px var(--color-error),
			var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
	}

	.search-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 6px 6px 6px 12px;
	}
	.search-replace-row {
		border-top: 1px solid var(--color-border);
	}

	.search-input {
		flex: 1;
		/* A floor, not a width: `min-width: auto` on a flex item is its intrinsic size, which
		   is what stops the field shrinking before the row wraps. */
		min-width: 6ch;
		width: 0;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		font: inherit;
		color: var(--color-text-primary);
	}
	.search-input::placeholder {
		color: var(--color-ui-muted);
	}
	.search-count {
		flex-shrink: 0;
		/* Short enough that the longest readout, a regex error, leaves the controls on the field's
		   line at the card's width; the whole message is in its title. */
		max-width: 7em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: var(--color-ui-muted);
	}
	/* Out of the flow rather than hidden, so the live region is there before its first count. */
	.search-count:empty {
		position: absolute;
	}
	.search-count.error {
		color: var(--color-error);
	}

	.search-controls {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		margin-left: auto;
	}
	.search-gap {
		width: 6px;
	}

	.search-icon-btn,
	.search-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.search-btn {
		width: auto;
		padding: 0 10px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}
	.search-icon-btn:hover:not(:disabled),
	.search-btn:hover:not(:disabled) {
		background: var(--menu-chip-bg-hover, rgba(255, 255, 255, 0.085));
		color: var(--color-text-primary);
	}
	.search-icon-btn:focus-visible,
	.search-btn:focus-visible {
		outline: 1px solid var(--color-ui-muted);
		outline-offset: -1px;
	}
	.search-icon-btn:disabled,
	.search-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.search-tog.on,
	.search-tog.on:hover {
		background: rgba(128, 128, 128, 0.2);
		color: var(--color-text-primary);
	}
	@supports (color: color-mix(in srgb, red, blue)) {
		.search-tog.on,
		.search-tog.on:hover {
			background: color-mix(in srgb, var(--color-text-primary) 14%, transparent);
		}
	}

	/* Forced colors drop every fill and shadow, which is all a pressed toggle and the focus ring
	   are drawn with. */
	@media (forced-colors: active) {
		.search-bar:focus-within {
			border-color: Highlight;
		}
		.search-tog.on,
		.search-tog.on:hover {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
		}
	}

	/* A pointer with no hover is a thumb, so the controls grow past their 28px; the row wraps
	   rather than crowding. */
	@media (pointer: coarse) {
		.search-icon-btn,
		.search-btn {
			min-width: 32px;
			min-height: 32px;
		}
	}
</style>
