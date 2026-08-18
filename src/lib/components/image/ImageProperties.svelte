<script lang="ts">
	import { untrack } from 'svelte';
	import type { ImageFields } from '../../core/nodes';
	import { IMAGE_CHROME_SELECTOR, type WidgetTarget } from './widget-selection-state.svelte';
	import { IMAGE_PROPERTIES_LABEL } from '../../a11y-strings';

	let {
		target,
		fields,
		buildBytes,
		onCommit,
		onDismiss
	}: {
		target: WidgetTarget;
		fields: ImageFields;
		/** The popover's dirty check is a byte comparison, and the bytes are the write
		 *  seam's to decide. */
		buildBytes: (target: WidgetTarget, fields: ImageFields) => string | null;
		onCommit: (target: WidgetTarget, newFields: ImageFields) => void;
		onDismiss: () => void;
	} = $props();

	let url = $state(untrack(() => fields.url));
	let alt = $state(untrack(() => fields.alt));
	let titleInput = $state(untrack(() => fields.title ?? ''));
	let titleTouched = $state(false);
	let popoverEl: HTMLDivElement | undefined = $state();

	// The seed is the BYTES, not the fields object: a rebuild mints a fresh one per render, so
	// identity says nothing about whether the image moved.
	let seedBytes = $state(untrack(() => buildBytes(target, fields)));

	// The popover follows the document while it is open: an undo — or any write landing from
	// outside this gesture — moves the image past the draft, and the dismiss commit would put the
	// old bytes back. The in-flight draft is discarded rather than a committed change reverted.
	$effect(() => {
		const live = buildBytes(target, fields);
		if (live === seedBytes) return;
		seedBytes = live;
		url = fields.url;
		alt = fields.alt;
		titleInput = fields.title ?? '';
		titleTouched = false;
	});

	// The commit runs in $effect cleanup so dismiss, image-switch (key change) and
	// programmatic clear all commit through one seam.
	$effect(() => {
		if (!popoverEl) return;
		const handler = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (target?.closest(IMAGE_CHROME_SELECTOR)) return;
			onDismiss();
		};
		document.addEventListener('pointerdown', handler, true);
		return () => document.removeEventListener('pointerdown', handler, true);
	});

	$effect(() => {
		return () => {
			commitIfChanged();
		};
	});

	function onTitleInput() {
		titleTouched = true;
	}

	function commitIfChanged() {
		const resolvedTitle = titleTouched
			? titleInput.length > 0
				? titleInput
				: undefined
			: fields.title;
		const next: ImageFields = {
			alt,
			url,
			...(resolvedTitle !== undefined ? { title: resolvedTitle } : {}),
			...(fields.width !== undefined ? { width: fields.width } : {}),
			...(fields.height !== undefined ? { height: fields.height } : {})
		};
		const newBytes = buildBytes(target, next);
		if (newBytes === seedBytes) return;
		onCommit(target, next);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			// Esc is cancel: discard local edits so the unmount commit short-circuits on
			// byte-equality rather than persisting in-flight typing.
			url = fields.url;
			alt = fields.alt;
			titleInput = fields.title ?? '';
			titleTouched = false;
			onDismiss();
		}
	}
</script>

<div
	bind:this={popoverEl}
	class="md-image-properties"
	role="dialog"
	aria-label={IMAGE_PROPERTIES_LABEL}
	tabindex="-1"
	onkeydown={handleKeyDown}
>
	<label>
		<span>URL</span>
		<input type="text" bind:value={url} />
	</label>
	<label>
		<span>Alt</span>
		<input type="text" bind:value={alt} />
	</label>
	<label>
		<span>Title</span>
		<input type="text" bind:value={titleInput} oninput={onTitleInput} />
	</label>
</div>

<style>
	.md-image-properties {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--color-bg-elevated, #2a2a2a);
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		padding: 8px;
		display: grid;
		gap: 6px;
		min-width: 280px;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	label {
		display: grid;
		grid-template-columns: 60px 1fr;
		align-items: center;
		gap: 8px;
	}
	input {
		background: var(--color-surface, #2d3033);
		color: var(--color-text-secondary, #eee);
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		padding: 4px 6px;
		border-radius: var(--radius-ui, 3px);
		font-family: inherit;
		font-size: 12px;
	}
</style>
