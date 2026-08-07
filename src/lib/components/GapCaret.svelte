<script lang="ts">
	/**
	 * The between-blocks caret's own surface: a zero-height proxy that takes DOM focus while
	 * the gap is live, so the caret has somewhere to be after the source block gives it up.
	 * It lives in the BlockList, outside every block's surface, so it contributes nothing to
	 * any block's textContent walk. Keys here are the pure exits, and every input — text,
	 * IME, paste, drop — is refused at `beforeinput` until the editing wave owns it.
	 */
	import type { FocusActions } from '../action-contracts';
	import { GAP_CARET_LABEL } from '../a11y-strings';

	let { index, focusActions }: { index: number; focusActions: FocusActions | undefined } = $props();

	let proxyEl: HTMLElement | undefined = $state();

	// Rendering, not sequencing: the component exists only while it IS the live gap.
	$effect(() => {
		proxyEl?.focus();
	});

	// The move that leaves must not be re-captured by the boundary it is leaving.
	const EXIT = { skipGapStop: true } as const;

	function leaveForward(): void {
		void focusActions?.moveFocus(index, 'start', EXIT);
	}

	function leaveBackward(): void {
		void focusActions?.moveFocus(index - 1, 'end', EXIT);
	}

	function onKeyDown(event: KeyboardEvent): void {
		// Modified chords resolve through the global table as they do anywhere else.
		if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowRight':
			case 'Delete':
				event.preventDefault();
				return leaveForward();
			case 'ArrowUp':
			case 'ArrowLeft':
			case 'Backspace':
				event.preventDefault();
				return leaveBackward();
			case 'Escape':
				event.preventDefault();
				return index === 0 ? leaveForward() : leaveBackward();
		}
	}
</script>

<div class="gap-caret" data-gap-caret>
	<div
		bind:this={proxyEl}
		class="gap-caret-proxy"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-label={GAP_CARET_LABEL}
		spellcheck="false"
		onkeydown={onKeyDown}
		onbeforeinput={(event) => event.preventDefault()}
	></div>
</div>

<style>
	/* Out of flow entirely: the boundary it marks must keep the layout it had without it. */
	.gap-caret {
		flex: 0 0 auto;
		height: 0;
		overflow: visible;
	}
	.gap-caret-proxy {
		width: 100%;
		height: 0;
		outline: none;
	}
</style>
