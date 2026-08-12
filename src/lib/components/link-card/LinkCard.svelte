<script lang="ts">
	import { untrack } from 'svelte';
	import {
		LINK_CARD_LABEL,
		LINK_CARD_OPEN,
		LINK_CARD_REMOVE,
		LINK_CARD_URL
	} from '../../a11y-strings';

	// Anchored chrome over one link construct. Enter commits; Escape is the host's, since it must
	// also close a card the document still has the caret for.
	//
	// `role="dialog"` WITHOUT `aria-modal`: a click leaves the card beside a live caret and the
	// document behind stays the user's to type in, which is what aria-modal would tell a screen
	// reader is false. The trap engages on ENTRY (Mod+K, or focus reaching the field), where the
	// claim is true, and Escape returns the caret it borrowed.
	let {
		url,
		canWrite,
		focusEpoch,
		onCommit,
		onOpenLink,
		onRemove,
		resolveHref
	}: {
		url: string;
		/** Bumped by each keyboard entry; the field takes focus when it changes. */
		focusEpoch: number;
		/** False when the write seam declines this construct outright — a rung-claimed link, which
		 *  no url makes writable. Enter then does nothing rather than silently dropping the edit. */
		canWrite: boolean;
		onCommit: (url: string) => void;
		onOpenLink: (url: string, event: MouseEvent) => void;
		/** Absent in create mode: there is no construct to remove until Enter mints one. */
		onRemove?: () => void;
		/** The render path's own href funnel — a consumer rewrite, then the scheme allowlist.
		 *  Undefined is a blocked scheme, and Open is the sink that must not receive one. */
		resolveHref: (url: string) => string | undefined;
	} = $props();

	let draft = $state(untrack(() => url));
	// The card OPENS on a blocked link so the URL can be repaired, but may not hand that URL
	// onward: `onLinkActivate` reaches a shell's own opener, and this is the only door into it
	// carrying a URL the user typed rather than the document's. An empty draft resolves as a
	// relative URL, so it declines too.
	const openable = $derived(draft.trim() === '' ? undefined : resolveHref(draft));
	let seed = $state(untrack(() => url));
	let cardEl: HTMLDivElement | undefined = $state();
	let urlInput: HTMLInputElement | undefined = $state();
	// Starts at the click's zero rather than at the prop: a card MOUNTED by the chord has a
	// non-zero epoch already, and seeding from the prop would read that as "nothing to do".
	let focusedEpoch = 0;

	$effect(() => {
		if (focusEpoch === focusedEpoch) return;
		focusedEpoch = focusEpoch;
		urlInput?.focus();
		urlInput?.select();
	});

	// The card follows the document while it is open: an undo — or any write landing from outside
	// this gesture — moves the destination past the draft, and Enter would put the old bytes back.
	// The in-flight draft is discarded rather than a committed change reverted.
	$effect(() => {
		if (url === seed) return;
		seed = url;
		draft = url;
	});

	function focusStops(): HTMLElement[] {
		return cardEl
			? Array.from(cardEl.querySelectorAll<HTMLElement>('input, button:not([disabled])'))
			: [];
	}

	function stepTrap(backwards: boolean): void {
		const stops = focusStops();
		if (stops.length === 0) return;
		const current =
			document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
		const next = (current === -1 ? 0 : current + (backwards ? -1 : 1)) % stops.length;
		stops[(next + stops.length) % stops.length].focus();
	}

	function handleKeyDown(e: KeyboardEvent): void {
		// An IME's confirm/step keystrokes arrive as ordinary keydowns mid-composition; they are
		// the composition's, never the card's.
		if (e.isComposing) return;
		if (e.key === 'Tab') {
			e.preventDefault();
			stepTrap(e.shiftKey);
			return;
		}
		// The entry chord re-asserts the card the focus is already inside, so it is a no-op here —
		// but a consumed one: no surface the editor owns hands `Mod+K` back to the browser.
		// CapsLock uppercases the key without a Shift modifier, which is still the plain chord.
		if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
			e.preventDefault();
		}
	}

	function handleUrlKeyDown(e: KeyboardEvent): void {
		if (e.isComposing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			if (canWrite) onCommit(draft);
		}
	}
</script>

<div
	bind:this={cardEl}
	class="md-link-card"
	data-link-card
	role="dialog"
	aria-label={LINK_CARD_LABEL}
	tabindex="-1"
	onkeydown={handleKeyDown}
>
	<label>
		<span>URL</span>
		<input
			bind:this={urlInput}
			bind:value={draft}
			type="text"
			aria-label={LINK_CARD_URL}
			onkeydown={handleUrlKeyDown}
		/>
	</label>
	<div class="md-link-card-actions">
		<button
			type="button"
			disabled={openable === undefined}
			onclick={(e) => openable !== undefined && onOpenLink(openable, e)}>{LINK_CARD_OPEN}</button
		>
		{#if onRemove}
			<button type="button" onclick={onRemove}>{LINK_CARD_REMOVE}</button>
		{/if}
	</div>
</div>

<style>
	.md-link-card {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 100;
		display: grid;
		gap: 6px;
		min-width: 280px;
		padding: 8px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		background: var(--color-bg-elevated, #2a2a2a);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	label {
		display: grid;
		grid-template-columns: 40px 1fr;
		align-items: center;
		gap: 8px;
	}
	input {
		padding: 4px 6px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
		background: var(--color-surface, #2d3033);
		color: var(--color-text-secondary, #eee);
		font-family: inherit;
		font-size: 12px;
	}
	.md-link-card-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	button {
		padding: 3px 8px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
		background: transparent;
		color: var(--color-text-secondary, #eee);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	button:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
	}
</style>
