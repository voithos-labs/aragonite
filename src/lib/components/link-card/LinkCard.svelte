<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		LINK_CARD_LABEL,
		LINK_CARD_OPEN,
		LINK_CARD_REMOVE,
		LINK_CARD_URL
	} from '../../a11y-strings';
	import MenuIcon from '../menu/MenuIcon.svelte';

	// A small panel positioned over one link construct. Enter commits; Escape is the host's,
	// since it must also close a card the document still has the caret for.
	//
	// `role="dialog"` without `aria-modal`: a click leaves the card beside a live caret and the
	// document behind stays the user's to type in, which is the opposite of what aria-modal would
	// tell a screen reader. The focus trap starts on entry (Mod+K, or focus reaching the field),
	// where that claim is true, and Escape returns the caret it borrowed.
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
		/** False when the write path refuses this construct outright: a link owned by an inline
		 *  syntax handler. Enter then does nothing rather than silently dropping the edit. */
		canWrite: boolean;
		onCommit: (url: string) => void;
		onOpenLink: (url: string, event: MouseEvent) => void;
		/** Absent in create mode: there is no construct to remove until Enter writes one. */
		onRemove?: () => void;
		/** The href as the render path resolves it: a consumer rewrite, then the scheme
		 *  allowlist. Undefined means a blocked scheme, which Open must never be handed. */
		resolveHref: (url: string) => string | undefined;
	} = $props();

	let draft = $state(untrack(() => url));
	// The card opens on a blocked link so the URL can be repaired, but may not pass that URL
	// on: `onLinkActivate` reaches the host app's own opener, and this is the only way in
	// carrying a URL the user typed rather than the document's. An empty draft resolves as a
	// relative URL, so it is refused too.
	const openable = $derived(draft.trim() === '' ? undefined : resolveHref(draft));
	let seed = $state(untrack(() => url));
	let cardEl: HTMLDivElement | undefined = $state();
	let urlInput: HTMLInputElement | undefined = $state();
	// Starts at the click's zero rather than at the prop: a card mounted by the chord already
	// has a non-zero counter, and starting from the prop would read that as "nothing to do".
	let focusedEpoch = 0;

	$effect(() => {
		if (focusEpoch === focusedEpoch) return;
		focusedEpoch = focusEpoch;
		// After the tick, not now: focusing the field before the host has placed the card, while it
		// still sits at the editor's origin, scrolls the viewport to the top of the document.
		void tick().then(() => {
			urlInput?.focus();
			urlInput?.select();
		});
	});

	// The card follows the document while it is open: an undo, or any write from outside this
	// gesture, moves the destination past the draft, and Enter would put the old bytes back.
	// The unfinished draft is discarded rather than a committed change reverted.
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
		// The entry chord asks again for the card focus is already inside, so it does nothing
		// here, but it is still taken: nothing the editor owns hands `Mod+K` back to the browser.
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
	<label class="md-link-card-field">
		<span class="md-link-card-caption">URL</span>
		<input
			bind:this={urlInput}
			bind:value={draft}
			type="text"
			aria-label={LINK_CARD_URL}
			placeholder="https://"
			onkeydown={handleUrlKeyDown}
		/>
	</label>
	<div class="md-link-card-actions">
		<button
			type="button"
			class="md-link-card-btn"
			aria-label={LINK_CARD_OPEN}
			title={LINK_CARD_OPEN}
			disabled={openable === undefined}
			onclick={(e) => openable !== undefined && onOpenLink(openable, e)}
		>
			<MenuIcon name="external-link" />
		</button>
		{#if onRemove}
			<button
				type="button"
				class="md-link-card-btn"
				aria-label={LINK_CARD_REMOVE}
				title={LINK_CARD_REMOVE}
				onclick={onRemove}
			>
				<MenuIcon name="unlink" />
			</button>
		{/if}
	</div>
</div>

<style>
	/* Built like the editor's menus (`.md-menu`, editor.css) and the image toolbar's field: a
	   caption over an underlined input with icon buttons beside it, so the card reads as one of
	   the editor's popovers rather than a form. */
	.md-link-card {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 100;
		display: flex;
		align-items: flex-end;
		gap: 6px;
		width: 300px;
		padding: 8px 8px 8px 10px;
		box-sizing: border-box;
		background: var(--color-bg, #2c2c2a);
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 8px;
		box-shadow: var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
		font-family: var(--font-ui, system-ui, sans-serif);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary, #e8e8e5);
	}
	.md-link-card-field {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.md-link-card-caption {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted, #aaaaaa);
	}
	/* Underlined, not boxed: one rule under the text still reads as a field to fill in, where a
	   second rounded box inside a rounded card reads as a frame inside a frame. */
	.md-link-card-field input {
		width: 100%;
		box-sizing: border-box;
		background: transparent;
		color: var(--color-text-primary, #e8e8e5);
		border: none;
		border-bottom: 1px solid var(--color-border, #3e3e3b);
		border-radius: 0;
		padding: 3px 1px 5px;
		font-family: inherit;
		font-size: 13px;
		line-height: 1.4;
		outline: none;
		transition: border-color 120ms ease-out;
	}
	.md-link-card-field input:focus {
		border-bottom-color: var(--color-accent, #567b67);
	}
	.md-link-card-field input::placeholder {
		color: var(--color-text-muted, #aaaaaa);
	}
	.md-link-card-actions {
		display: flex;
		gap: 2px;
		/* The buttons sit level with the input's rule, not with the caption. */
		padding-bottom: 1px;
	}
	.md-link-card-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted, #93938d);
		cursor: pointer;
	}
	.md-link-card-btn:hover:not(:disabled),
	.md-link-card-btn:focus-visible {
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
		color: var(--color-text-primary, #e8e8e5);
		outline: none;
	}
	.md-link-card-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
