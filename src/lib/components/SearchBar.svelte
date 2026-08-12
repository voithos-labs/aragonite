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
			<button
				type="button"
				class="search-tog"
				class:on={search.options.caseSensitive}
				title={SEARCH_MATCH_CASE}
				aria-label={SEARCH_MATCH_CASE}
				aria-pressed={search.options.caseSensitive}
				onclick={() => search.setOptions({ caseSensitive: !search.options.caseSensitive })}
				>Aa</button
			>
			<button
				type="button"
				class="search-tog"
				class:on={search.options.wholeWord}
				title={SEARCH_WHOLE_WORD}
				aria-label={SEARCH_WHOLE_WORD}
				aria-pressed={search.options.wholeWord}
				onclick={() => search.setOptions({ wholeWord: !search.options.wholeWord })}>W</button
			>
			<button
				type="button"
				class="search-tog"
				class:on={search.options.regex}
				title={SEARCH_REGEX}
				aria-label={SEARCH_REGEX}
				aria-pressed={search.options.regex}
				onclick={() => search.setOptions({ regex: !search.options.regex })}>.*</button
			>
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
</style>
