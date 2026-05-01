<script lang="ts">
	import { buildImageSourceBytes, type ImageFields } from './image-source-bytes';

	let {
		fields,
		onCommit,
		onDismiss
	}: {
		fields: ImageFields;
		onCommit: (newFields: ImageFields) => void;
		onDismiss: () => void;
	} = $props();

	let url = $state(fields.url);
	let alt = $state(fields.alt);
	let titleInput = $state(fields.title ?? '');
	let titleTouched = $state(false);
	let popoverEl: HTMLDivElement | undefined = $state();

	const initialBytes = buildImageSourceBytes(fields);

	// Capture phase: commit before any selection-clearing handler runs.
	$effect(() => {
		if (!popoverEl) return;
		const handler = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (target?.closest('[data-image-widget], [data-image-overlay]')) return;
			commitIfChanged();
			onDismiss();
		};
		document.addEventListener('pointerdown', handler, true);
		return () => document.removeEventListener('pointerdown', handler, true);
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
		const newBytes = buildImageSourceBytes(next);
		if (newBytes === initialBytes) return;
		onCommit(next);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onDismiss();
		}
	}
</script>

<div
	bind:this={popoverEl}
	class="md-image-properties"
	role="dialog"
	aria-label="Image properties"
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
		border: 1px solid var(--color-ui-muted, #444);
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
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #eee);
		border: 1px solid var(--color-ui-muted, #444);
		padding: 4px 6px;
		border-radius: 3px;
		font-family: inherit;
		font-size: 12px;
	}
</style>
