<script lang="ts">
	import { tick } from 'svelte';
	import {
		CODE_COPY_LABEL,
		CODE_COPIED_LABEL,
		CODE_LANGUAGE_FIELD,
		CODE_MENU_LABEL,
		CODE_RAIL_LABEL,
		CODE_RUN_LABEL,
		codeLanguageLabel
	} from '../../../a11y-strings';
	import type { CodeMenuItem } from '../../../editor-keys';
	import { getLanguageAliases, getLanguageGrammar, listLanguages } from './code-languages';

	// What the modes that draw no fence show instead: the language control plus whatever
	// actions the host has enabled by installing a hook. A draft lives here and only a
	// commit reaches the tree.
	let {
		info,
		editable,
		autoOpen = false,
		onCommit,
		onCancel,
		onRun,
		onCopy,
		menuItems
	}: {
		/** The opener's full info string; the button shows its first token. */
		info: string;
		/** False in reading mode, which writes no bytes, so the chip is then a label. */
		editable: boolean;
		/** Open the language field as soon as the rail mounts: a fence the user just created
		 *  has no language yet, and asking is the whole reason the chip exists. */
		autoOpen?: boolean;
		/** Only Enter or a list pick calls this, and it owns the caret's landing afterwards. */
		onCommit: (info: string) => void;
		/** Nothing written. Escape asks for the caret back; a blur must not yank it from
		 *  wherever the user just clicked, so it does not. */
		onCancel: (returnCaret: boolean) => void;
		/** Absent when the host installed no execution hook, so no run button renders. */
		onRun?: () => void;
		/** Copies the fence body; resolves once the clipboard write settles. */
		onCopy: () => Promise<boolean>;
		/** Consulted on each open, so items read live state. Empty renders no affordance. */
		menuItems?: () => readonly CodeMenuItem[];
	} = $props();

	const language = $derived(info.split(/\s+/)[0] || 'text');

	let editing = $state(false);
	let draft = $state('');
	// Filtering waits for a keystroke: the field opens empty, and until then the whole list
	// shows with the block's own language leading it, which is what a bare Enter re-commits.
	let filtering = $state(false);
	let activeIndex = $state(0);
	/** The user moved the highlight, so the row it sits on wins over whatever they typed. */
	let highlightMoved = false;
	let copied = $state(false);
	let menuOpen = $state(false);
	let openMenuItems = $state<readonly CodeMenuItem[]>([]);

	let railEl: HTMLElement | undefined = $state();
	let chipEl: HTMLElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLElement | undefined = $state();
	let pickerEl: HTMLElement | undefined = $state();
	let menuEl: HTMLElement | undefined = $state();
	let menuButtonEl: HTMLElement | undefined = $state();

	// The picker offers what the renderer can actually highlight, filtered as the draft is
	// typed. `text` is always offered: it is how a user clears a language, and no grammar
	// registers under that name.
	const suggestions = $derived.by(() => {
		const all = ['text', ...listLanguages().filter((name) => name !== 'text')];
		const needle = filtering ? draft.trim().toLowerCase() : '';
		if (needle.length > 0) {
			// An alternate spelling is a search key, never a row of its own: `rs` finds `rust`,
			// and the list still carries one entry per language.
			const spellings = (name: string) => [name, ...getLanguageAliases(name)];
			const starts = all.filter((name) => spellings(name).some((s) => s.startsWith(needle)));
			const seated = new Set(starts);
			const contains = all.filter(
				(name) => !seated.has(name) && spellings(name).some((s) => s.includes(needle))
			);
			return [...starts, ...contains];
		}
		// Unfiltered, the block's own language leads, spelled as the fence spells it, so the
		// row that matters is where the eye already is and its canonical form is not below it.
		const current = language;
		const rest = all.filter((name) => name !== current && !isCurrentLanguage(name));
		return [current, ...rest];
	});

	/** One language in two spellings is still the block's own, so the check compares what the
	 *  registry resolves rather than the text. */
	function isCurrentLanguage(name: string): boolean {
		const canonical = (spelling: string) =>
			getLanguageGrammar(spelling)?.name ?? spelling.toLowerCase();
		return canonical(name) === canonical(language);
	}

	// The highlight cannot outrun a filter that shortened the list under it.
	$effect(() => {
		if (activeIndex >= suggestions.length) activeIndex = 0;
	});

	// Opens on mount for a fence that was just created. Checked against `editable` like every
	// other write, and fired once: setting it again would reopen the field after every commit.
	let autoOpened = false;
	$effect(() => {
		if (!autoOpen || autoOpened || !editable) return;
		autoOpened = true;
		open();
	});

	export function open(): void {
		if (!editable) return;
		draft = '';
		filtering = false;
		highlightMoved = false;
		menuOpen = false;
		editing = true;
		// Row 0 is the block's own language (see `suggestions`), so the highlight starts where
		// a bare Enter re-commits what is already set.
		activeIndex = 0;
		// A first guess at the trigger's position, before the popout renders. Without it the
		// popout mounts at the viewport's top-left corner while it waits to be measured, and
		// focusing the field inside it drags the page up there, which is the page jumping to
		// the top when a code block is created. The measurement below refines it.
		const anchor = chipEl?.getBoundingClientRect();
		if (anchor) {
			listAt = {
				x: Math.max(EDGE_MARGIN, anchor.right - 200),
				y: anchor.bottom + ANCHOR_GAP,
				maxHeight: MAX_POPOUT_HEIGHT
			};
		}
		void tick().then(() => {
			// `preventScroll`: the gutter is already on screen, and a scroll here would arrive
			// as a real scroll event on the repositioning path below.
			inputEl?.focus({ preventScroll: true });
		});
	}

	function close(): void {
		editing = false;
	}

	function commit(value: string): void {
		close();
		// `text` is the picker's way of saying "no language"; the info string says it with ''.
		onCommit(value.trim() === 'text' ? '' : value);
	}

	function onFieldKeyDown(e: KeyboardEvent): void {
		// The field owns its keys while open: an Escape that closes it must not reach anything
		// else listening for one. An Enter or Escape during a composition belongs to the IME.
		e.stopPropagation();
		if (e.isComposing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			// A spelling the registry resolves is a name, not a search: it commits as typed, so
			// `js` survives a picker whose rows are canonical. A moved highlight takes the row.
			const typed = draft.trim();
			const namesLanguage = !highlightMoved && typed !== '' && getLanguageGrammar(typed) !== null;
			commit(
				namesLanguage ? typed : (suggestions[activeIndex] ?? (typed === '' ? language : typed))
			);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			close();
			onCancel(true);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightMoved = true;
			activeIndex = suggestions.length === 0 ? 0 : (activeIndex + 1) % suggestions.length;
			scrollActiveIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightMoved = true;
			activeIndex =
				suggestions.length === 0 ? 0 : (activeIndex - 1 + suggestions.length) % suggestions.length;
			scrollActiveIntoView();
		}
	}

	// Only for keyboard travel: the highlight must stay on screen as it moves. Opening does
	// not call this: the menu opens at row 0, which is already in view.
	function scrollActiveIntoView(): void {
		void tick().then(() => {
			listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
		});
	}

	function onFieldBlur(e: FocusEvent): void {
		if (!editing) return;
		// A pointer moving from the field to its own list is not a dismissal: the list's
		// mousedown handler commits, and this must not tear the field down before it does.
		const next = e.relatedTarget;
		if (next instanceof Node && (railEl?.contains(next) || pickerEl?.contains(next))) return;
		close();
		onCancel(false);
	}

	async function runCopy(): Promise<void> {
		copied = await onCopy();
	}

	// The confirmation lasts exactly as long as the gutter is shown: the pointer leaving the
	// block, or focus leaving the gutter, hides it, and the next time it appears is a new
	// gesture that should offer to copy again rather than still report the last one. Reverting
	// on a clock would be sequencing on a timer, which G4.4 rules out.
	function clearCopied(): void {
		copied = false;
	}

	function toggleMenu(): void {
		if (menuOpen) {
			menuOpen = false;
			return;
		}
		close();
		openMenuItems = menuItems?.() ?? [];
		menuOpen = openMenuItems.length > 0;
	}

	function activateMenuItem(item: CodeMenuItem): void {
		if (item.disabled) return;
		menuOpen = false;
		item.run();
	}

	// Escape is handled on the buttons, not on their container: the gutter is a labelled
	// `group`, and a non-interactive role may not carry key handlers. Focus sits on the ⋮
	// button while the menu is open, and on an item once the user tabs in, so both are covered.
	function onMenuKeyDown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || !menuOpen) return;
		e.stopPropagation();
		e.preventDefault();
		menuOpen = false;
		menuButtonEl?.focus();
	}

	// The menu outlives the click that opened it, so it closes on the next click anywhere
	// else. Decided by what contains the click, not by the exact target: a click on a
	// disabled item is still inside.
	function onRailFocusOut(e: FocusEvent): void {
		const next = e.relatedTarget;
		if (next instanceof Node && (railEl?.contains(next) || menuEl?.contains(next))) return;
		menuOpen = false;
		clearCopied();
	}

	// ── Popout placement ──────────────────────────────────────────────────────
	// Both popouts are `position: fixed`, like the table's action menu: an absolutely
	// positioned one inside the block host would extend the editor's own scrollable area
	// when it overhangs the last block, which is the page growing under the user.
	// Fixed takes them out of flow entirely, so opening one can resize nothing.

	interface Placement {
		x: number;
		y: number;
		/** How much space the popout may take on the side it was placed, so a long list
		 *  scrolls inside that space instead of growing past the viewport edge. */
		maxHeight: number;
	}
	let listAt = $state<Placement | null>(null);
	let menuAt = $state<Placement | null>(null);

	const EDGE_MARGIN = 8;
	const ANCHOR_GAP = 6;
	/** A menu is a menu, not a column of the viewport: past this height it scrolls. The space
	 *  actually available still wins when it is smaller. */
	const MAX_POPOUT_HEIGHT = 320;

	/**
	 * Place a popout beside its trigger without ever covering it. Below is preferred, above is
	 * taken when below cannot hold it and above can, and whichever side wins caps the popout's
	 * height to the space actually there. A plain clamp into the viewport slides the box up over
	 * the button that opened it, which is exactly what must not happen.
	 */
	function placeAgainst(anchor: HTMLElement | undefined, popout: HTMLElement): Placement {
		const a = (anchor ?? popout).getBoundingClientRect();
		const size = popout.getBoundingClientRect();
		// Always downward. Moving above when the space below runs short would make the menu
		// appear on whichever side the block happened to sit, so the same gesture would open
		// in two directions; a menu always under its trigger is the predictable one. When the
		// space is short the popout scrolls inside what is there instead of moving.
		const roomBelow = window.innerHeight - a.bottom - ANCHOR_GAP - EDGE_MARGIN;
		const maxHeight = Math.min(MAX_POPOUT_HEIGHT, Math.max(120, roomBelow));
		const y = a.bottom + ANCHOR_GAP;
		// Right-aligned to the trigger, then held inside the viewport horizontally only.
		const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size.width - EDGE_MARGIN);
		const x = Math.min(Math.max(EDGE_MARGIN, a.right - size.width), maxX);
		return { x, y, maxHeight };
	}

	$effect(() => {
		if (!editing || !pickerEl) {
			listAt = null;
			return;
		}
		listAt = placeAgainst(chipEl, pickerEl);
	});

	$effect(() => {
		if (!menuOpen || !menuEl) {
			menuAt = null;
			return;
		}
		menuAt = placeAgainst(menuButtonEl, menuEl);
	});

	// A fixed popout does not move with the gutter it hangs off, so it is placed again against
	// its trigger whenever the page scrolls or resizes. Placed again, not closed: closing it
	// would throw away a menu the user had just opened and would race the scroll that focusing
	// the field can cause, closing the picker in the same tick it opened.
	$effect(() => {
		if (!editing && !menuOpen) return;
		const reposition = (): void => {
			if (editing && pickerEl) listAt = placeAgainst(chipEl, pickerEl);
			if (menuOpen && menuEl) menuAt = placeAgainst(menuButtonEl, menuEl);
		};
		window.addEventListener('scroll', reposition, { capture: true, passive: true });
		window.addEventListener('resize', reposition, { passive: true });
		return () => {
			window.removeEventListener('scroll', reposition, { capture: true });
			window.removeEventListener('resize', reposition);
		};
	});

	const popoutStyle = (at: Placement | null): string =>
		at
			? `left:${at.x}px;top:${at.y}px;max-height:${at.maxHeight}px`
			: 'left:0;top:0;visibility:hidden';

	// Whether a hook exists is the whole condition; see `EditorPolicies.onRunCode`.
	const showRun = $derived(editable && onRun !== undefined);
	const showMenu = $derived(menuItems !== undefined);
</script>

<!-- Lucide (ISC) path data, written out here rather than depended on: the editor ships two
	dependencies and an icon package would be a third. Sized 14 / stroke 1.75 to match the
	host app's menus. See THIRD-PARTY-NOTICES.md. -->
{#snippet icon(paths: string)}
	<svg
		viewBox="0 0 24 24"
		width="14"
		height="14"
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static lucide path markup from this module's own constants -->
		{@html paths}
	</svg>
{/snippet}

<!-- `group`, not `toolbar`: these controls belong together, but a toolbar promises
	arrow-key navigation between them, which this does not implement. -->
<div
	bind:this={railEl}
	class="code-rail"
	class:code-rail-open={editing || menuOpen}
	role="group"
	aria-label={CODE_RAIL_LABEL}
	onfocusout={onRailFocusOut}
>
	<span bind:this={chipEl} class="code-lang-chip">
		<button
			type="button"
			class="code-lang-button"
			class:open={editing}
			aria-haspopup="listbox"
			aria-expanded={editing}
			aria-label={codeLanguageLabel(language)}
			onclick={() => (editing ? close() : open())}
			>{language}{@render icon('<path d="m6 9 6 6 6-6"/>')}</button
		>
	</span>

	{#if showRun}
		<button type="button" class="code-rail-action" aria-label={CODE_RUN_LABEL} onclick={onRun}>
			{@render icon(
				'<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'
			)}
		</button>
	{/if}

	<button
		type="button"
		class="code-rail-action"
		aria-label={copied ? CODE_COPIED_LABEL : CODE_COPY_LABEL}
		onclick={runCopy}
		onpointerleave={clearCopied}
	>
		{#if copied}
			{@render icon('<path d="M20 6 9 17l-5-5"/>')}
		{:else}
			{@render icon(
				'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
			)}
		{/if}
	</button>

	{#if showMenu}
		<button
			bind:this={menuButtonEl}
			type="button"
			class="code-rail-action"
			aria-label={CODE_MENU_LABEL}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={toggleMenu}
			onkeydown={onMenuKeyDown}
		>
			{@render icon(
				'<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>'
			)}
		</button>
	{/if}
</div>

{#if editing}
	<div
		bind:this={pickerEl}
		class="md-menu code-rail-popout code-lang-picker"
		style={popoutStyle(listAt)}
	>
		<div class="code-lang-search">
			{@render icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')}
			<input
				bind:this={inputEl}
				bind:value={draft}
				type="text"
				spellcheck="false"
				autocomplete="off"
				role="combobox"
				aria-expanded="true"
				aria-controls="code-lang-list"
				aria-label={CODE_LANGUAGE_FIELD}
				placeholder="Search for a language…"
				oninput={() => {
					filtering = true;
					highlightMoved = false;
					activeIndex = 0;
				}}
				onkeydown={onFieldKeyDown}
				onfocusout={onFieldBlur}
			/>
		</div>
		{#if suggestions.length > 0}
			<ul bind:this={listEl} id="code-lang-list" class="code-lang-list" role="listbox">
				{#each suggestions as name, i (name)}
					<li role="none">
						<button
							type="button"
							role="option"
							aria-selected={isCurrentLanguage(name)}
							data-active={i === activeIndex}
							tabindex="-1"
							onmouseenter={() => {
								highlightMoved = true;
								activeIndex = i;
							}}
							onmousedown={(e) => {
								// mousedown, not click: the field's blur would otherwise cancel the edit
								// before a click ever landed.
								e.preventDefault();
								commit(name);
							}}
						>
							<span class="code-lang-name">{name}</span>
							{#if isCurrentLanguage(name)}
								<span class="code-lang-check">
									{@render icon('<path d="M20 6 9 17l-5-5"/>')}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="code-lang-empty">No language matches</p>
		{/if}
	</div>
{/if}

{#if menuOpen}
	<ul
		bind:this={menuEl}
		class="md-menu code-rail-popout code-rail-menu"
		role="menu"
		aria-label={CODE_MENU_LABEL}
		style={popoutStyle(menuAt)}
	>
		{#each openMenuItems as item (item.id)}
			<li role="none">
				<button
					type="button"
					role="menuitem"
					disabled={item.disabled}
					onclick={() => activateMenuItem(item)}
					onkeydown={onMenuKeyDown}>{item.label}</button
				>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/* Bare controls over the code box's top right, with no container of their own, so the code
	   they sit above reads through between them. Positioned against the block host, whose
	   box the code box fills below the host's 6px stand-off (editor.css, fencedCode), and out
	   of the code box's own scroller so a horizontal scroll leaves them where they are. */
	.code-rail {
		position: absolute;
		top: 12px;
		right: 8px;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 13px;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease-out;
	}

	/* Block hover or block focus, and nothing else, plus the two states that outlive both,
	   since a popout must not vanish from under the pointer that opened it. Child and sibling
	   combinators, so an outer container's hover never reveals a nested block's rail. */
	:global(.block-host:hover) > .code-rail,
	:global(.code-block:focus) ~ .code-rail,
	.code-rail:focus-within,
	.code-rail-open {
		opacity: 1;
		pointer-events: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.code-rail {
			transition: none;
		}
	}

	.code-lang-chip {
		display: flex;
		align-items: center;
	}

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted, #999999);
		font: inherit;
		cursor: pointer;
	}

	.code-lang-button {
		padding: 4px 6px;
	}

	/* An open picker keeps its trigger lit, so the two read as one control. */
	.code-lang-button.open {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
		color: var(--color-text-secondary, #cfcfca);
	}

	.code-rail-action {
		width: 24px;
		height: 24px;
		padding: 0;
	}

	button:hover:not(:disabled) {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
		color: var(--color-text-secondary, #d6d9e0);
	}

	button:focus-visible {
		outline: 1px solid var(--color-accent, #567b67);
		outline-offset: -1px;
	}

	/* The host app's own menu styling, so a code block's menus read as the app's. */
	/* Panel, hairline, shadow, face and colour come from the shared `.md-menu` (editor.css);
	   this adds only the picker's own layout. */
	.code-rail-popout {
		display: flex;
		flex-direction: column;
		min-width: 200px;
		margin: 0;
		list-style: none;
		overflow: hidden;
	}

	/* Search sits inside the menu rather than swapping the gutter's chip for a field: the chip
	   is a fixed box that never changes width, so opening the picker moves nothing. */
	.code-lang-search {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 0 auto;
		margin: -4px -4px 4px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--menu-search-divider, rgba(255, 255, 255, 0.08));
		color: var(--color-ui-muted, #8f8f89);
	}

	.code-lang-search input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-primary, #e8e8e5);
		font: inherit;
		font-size: 13px;
		outline: none;
	}

	.code-lang-search input::placeholder {
		color: var(--color-ui-dulled, #a3a39d);
	}

	.code-lang-list {
		flex: 1 1 auto;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* A hairline thumb, as the host app's list menus use, since the platform's default bar is
	   wider than the rows it sits beside. */
	.code-lang-list::-webkit-scrollbar {
		width: 1px;
	}
	.code-lang-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.code-lang-list::-webkit-scrollbar-thumb {
		background: var(--menu-scrollbar-thumb, rgba(255, 255, 255, 0.18));
	}
	.code-lang-list {
		scrollbar-width: thin;
		scrollbar-color: var(--menu-scrollbar-thumb, rgba(255, 255, 255, 0.18)) transparent;
	}

	.code-rail-popout button {
		gap: 9px;
		width: 100%;
		justify-content: flex-start;
		padding: 7px 10px;
		border-radius: 5px;
		color: inherit;
		font: inherit;
		text-align: left;
		white-space: nowrap;
	}

	.code-lang-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The check marks what is set, inline on its own row, in the text colour: the host app
	   colours no text with its accent, and its menus are what these copy. */
	.code-lang-check {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--color-text-primary, #e8e8e5);
	}

	.code-rail-popout button:hover:not(:disabled),
	.code-lang-list button[data-active='true'] {
		background: var(--menu-item-hover, rgba(255, 255, 255, 0.07));
		color: inherit;
	}

	.code-rail-popout button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.code-lang-empty {
		margin: 0;
		padding: 7px 10px;
		color: var(--color-ui-dulled, #a3a39d);
	}
</style>
