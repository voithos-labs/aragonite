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
	let title = $state(fields.title ?? '');

	const initialBytes = buildImageSourceBytes(fields);

	function handleBlurAll(e: FocusEvent) {
		// Tabbing between fields fires focusout with relatedTarget still inside the popover; only commit when focus actually leaves.
		const next = e.relatedTarget as Node | null;
		const popover = e.currentTarget as HTMLElement;
		if (next && popover.contains(next)) return;
		commitIfChanged();
		onDismiss();
	}

	function commitIfChanged() {
		const next: ImageFields = {
			alt,
			url,
			...(title.length > 0 ? { title } : {}),
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
	class="md-image-properties"
	role="dialog"
	aria-label="Image properties"
	tabindex="-1"
	onfocusoutcapture={handleBlurAll}
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
		<input type="text" bind:value={title} />
	</label>
</div>

<style>
	.md-image-properties {
		position: absolute;
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
