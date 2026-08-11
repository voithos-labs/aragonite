<script lang="ts">
	import { tick } from 'svelte';
	import { CODE_LANGUAGE_FIELD, codeLanguageLabel } from '../../../a11y-strings';

	// The fence-info door for the modes that paint no fence. The draft lives here and only a
	// commit reaches the tree.
	let {
		info,
		editable,
		onCommit,
		onCancel
	}: {
		/** The opener's full info string; the button shows its first token. */
		info: string;
		/** False in reading mode, which writes no bytes — the chip is then a label. */
		editable: boolean;
		/** Only Enter calls this, and it owns the caret's landing afterwards. */
		onCommit: (info: string) => void;
		/** Nothing written. Escape asks for the caret back; a blur must not yank it from
		 *  wherever the user just clicked, so it does not. */
		onCancel: (returnCaret: boolean) => void;
	} = $props();

	const language = $derived(info.split(/\s+/)[0] || 'text');

	let editing = $state(false);
	let draft = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	function open(): void {
		if (!editable) return;
		draft = info;
		editing = true;
		void tick().then(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	}

	function onFieldKeyDown(e: KeyboardEvent): void {
		// The field owns its keys while open: no Escape of this state may reach whatever else
		// listens for one. A composing Enter/Escape is the IME's, never the field's.
		e.stopPropagation();
		if (e.isComposing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			const committed = draft;
			editing = false;
			onCommit(committed);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editing = false;
			onCancel(true);
		}
	}

	function onFieldBlur(): void {
		if (!editing) return;
		editing = false;
		onCancel(false);
	}
</script>

<span class="code-lang-chip">
	{#if editing}
		<input
			bind:this={inputEl}
			bind:value={draft}
			type="text"
			spellcheck="false"
			aria-label={CODE_LANGUAGE_FIELD}
			onkeydown={onFieldKeyDown}
			onfocusout={onFieldBlur}
		/>
	{:else}
		<button type="button" aria-label={codeLanguageLabel(language)} onclick={open}>{language}</button
		>
	{/if}
</span>

<style>
	/* Positioned against the block host, whose box the code box fills, and out of the code
	   box's own scroller so a horizontal scroll leaves it where it is. */
	.code-lang-chip {
		position: absolute;
		top: 5px;
		right: 5px;
		z-index: 1;
		display: flex;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.75em;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
	}

	/* Transient, like the drag handle: the pointer over the block or the caret inside it, plus
	   the open field, which outlives both. Child and sibling combinators, so an outer container's
	   hover never reveals a nested block's chip. */
	:global(.block-host:hover) > .code-lang-chip,
	:global(.code-block:focus) ~ .code-lang-chip,
	.code-lang-chip:focus-within {
		opacity: 1;
		pointer-events: auto;
	}

	button,
	input {
		padding: 2px 6px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
		background: var(--color-bg-elevated, #2a2a2a);
		color: var(--color-accent, #567b67);
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
	}

	input {
		width: 9ch;
		color: var(--color-text, #eee);
		cursor: text;
	}
</style>
