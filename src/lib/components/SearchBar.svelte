<script lang="ts">
	import { getContext } from 'svelte';
	import { EDITOR_SERVICES_KEY, type EditorServices } from '../editor-keys';
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

	// `replaceExpanded` is owned by Editor so the root Ctrl+H shortcut and the
	// chevron share one source of truth; the chevron reports toggles back up.
	let {
		replaceExpanded = false,
		onToggleReplace
	}: {
		replaceExpanded?: boolean;
		onToggleReplace?: () => void;
	} = $props();

	const { search } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	const OPTION_TOGGLES = [
		{ key: 'caseSensitive', glyph: 'Aa', text: SEARCH_MATCH_CASE },
		{ key: 'wholeWord', glyph: 'W', text: SEARCH_WHOLE_WORD },
		{ key: 'regex', glyph: '.*', text: SEARCH_REGEX }
	] as const;

	let findInput = $state<HTMLInputElement>();
	$effect(() => {
		if (search.isOpen) findInput?.focus();
	});

	function onFindKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			e.shiftKey ? search.prev() : search.next();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			search.close();
		}
	}

	function onReplaceKeydown(e: KeyboardEvent) {
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
	<div class="search-bar" role="search">
		<div class="search-row">
			<button
				type="button"
				class="search-chevron"
				class:on={replaceExpanded}
				title={SEARCH_TOGGLE_REPLACE}
				aria-label={SEARCH_TOGGLE_REPLACE}
				aria-expanded={replaceExpanded}
				onclick={() => onToggleReplace?.()}>›</button
			>
			<input
				bind:this={findInput}
				class="search-input"
				placeholder={SEARCH_FIND}
				value={search.query}
				oninput={(e) => search.setQuery(e.currentTarget.value)}
				onkeydown={onFindKeydown}
				aria-label={SEARCH_FIND}
			/>
			{#each OPTION_TOGGLES as toggle (toggle.key)}
				<button
					type="button"
					class="search-tog"
					class:on={search.options[toggle.key]}
					title={toggle.text}
					aria-label={toggle.text}
					aria-pressed={search.options[toggle.key]}
					onclick={() => search.setOptions({ [toggle.key]: !search.options[toggle.key] })}
					>{toggle.glyph}</button
				>
			{/each}
			<span class="search-count" class:error={!!search.error}>
				{#if search.error}
					{search.error}
				{:else if search.isScanning}
					Searching…
				{:else if search.matches.length}
					{search.activeIndex + 1} / {search.matches.length}
				{:else if search.replacedCount != null}
					{search.replacedCount} replaced
				{:else}
					No results
				{/if}
			</span>
			<button
				type="button"
				class="search-nav"
				title={SEARCH_PREVIOUS_TITLE}
				aria-label={SEARCH_PREVIOUS_LABEL}
				onclick={() => search.prev()}>‹</button
			>
			<button
				type="button"
				class="search-nav"
				title={SEARCH_NEXT_TITLE}
				aria-label={SEARCH_NEXT_LABEL}
				onclick={() => search.next()}>›</button
			>
			<button
				type="button"
				class="search-x"
				title={SEARCH_CLOSE_TITLE}
				aria-label={SEARCH_CLOSE_LABEL}
				onclick={() => search.close()}>✕</button
			>
		</div>
		{#if replaceExpanded}
			<div class="search-row">
				<input
					class="search-input"
					placeholder={SEARCH_REPLACE}
					value={search.replacement}
					oninput={(e) => search.setReplacement(e.currentTarget.value)}
					onkeydown={onReplaceKeydown}
					aria-label={SEARCH_REPLACE}
				/>
				<button type="button" class="search-btn" onclick={() => search.replaceCurrent()}
					>Replace</button
				>
				<button type="button" class="search-btn" onclick={() => search.replaceAll()}>All</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.search-bar {
		position: absolute;
		top: 10px;
		right: 10px;
		/* Content-sized off the right edge, so without the cap a narrow host puts the bar's
		   left half (the find field) off screen instead of shrinking it. */
		max-width: calc(100% - 20px);
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 7px 8px;
		border-radius: 7px;
		background: var(--color-bg-elevated, #2a2c33);
		border: 1px solid var(--color-border, #3d4047);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
	}
	.search-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.search-input {
		background: var(--color-surface, #1b1c21);
		border: 1px solid var(--color-border, #44474f);
		border-radius: 4px;
		color: var(--color-text-secondary, #d6d9e0);
		padding: 3px 7px;
		height: 22px;
		/* A floor, not a width: `min-width: auto` on a flex item is its intrinsic size, which
		   is what stops the field shrinking before the row wraps. */
		min-width: 6ch;
	}
	.search-tog,
	.search-nav,
	.search-x,
	.search-btn,
	.search-chevron {
		color: var(--color-text-secondary, #d6d9e0);
		background: transparent;
		border: 1px solid var(--color-border, #44474f);
		border-radius: var(--radius-ui, 3px);
		cursor: pointer;
	}
	.search-tog {
		font: 600 11px monospace;
		padding: 1px 5px;
	}
	.search-tog.on,
	.search-chevron.on {
		color: var(--color-surface, #1e1f24);
		background: var(--color-accent, #567b67);
	}
	.search-nav,
	.search-x {
		border-color: transparent;
		padding: 1px 5px;
		font-size: 13px;
	}
	.search-btn {
		font-size: 11px;
		padding: 2px 7px;
	}
	.search-chevron {
		border-color: transparent;
		padding: 1px 4px;
		transition: transform 0.1s;
	}
	.search-chevron.on {
		transform: rotate(90deg);
	}
	.search-count {
		font-size: 11px;
		white-space: nowrap;
	}
	.search-count.error {
		color: var(--color-error, #e06c75);
	}

	/* A pointer with no hover is a thumb: the glyph buttons are ~16px boxes, under the WCAG
	   2.5.8 minimum, and the row wraps rather than crowding once they grow. */
	@media (pointer: coarse) {
		.search-tog,
		.search-nav,
		.search-x,
		.search-btn,
		.search-chevron {
			min-width: 24px;
			min-height: 24px;
		}
	}
</style>
