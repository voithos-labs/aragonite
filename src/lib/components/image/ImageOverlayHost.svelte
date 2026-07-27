<script lang="ts">
	import { getContext } from 'svelte';
	import type { Document } from '../../core/nodes';
	import type { PresentationMode } from '../../presentation-mode';
	import type { UndoController } from '../../editor-actions/deps';
	import { EDITOR_DOC_KEY, type EditorDoc } from '../../editor-keys';
	import type { EditorEvents } from '../../editor-events';
	import { installWidgetRangePainter } from '../../selection/widget-range-paint';
	import ImageProperties from './ImageProperties.svelte';
	import ImageResizeHandles from './ImageResizeHandles.svelte';
	import { createImageEditCommitter } from './image-edit-commit';
	import { imageFieldsFromInline } from './image-source-bytes';
	import type { WidgetSelectionState } from './widget-selection-state.svelte';

	// Mounted unconditionally by Editor — the effects below must observe
	// widget-selection changes, so the selected-widget {#if} lives here.
	let {
		widgetSelection,
		controller,
		events,
		getDoc,
		getEditorEl,
		getSelectionIsCustomRendered,
		getPresentationMode,
		lifetime
	}: {
		widgetSelection: WidgetSelectionState;
		controller: UndoController;
		events: EditorEvents;
		getDoc: () => Document;
		getEditorEl: () => HTMLElement | null;
		getSelectionIsCustomRendered: () => boolean;
		getPresentationMode: () => PresentationMode;
		lifetime: AbortSignal;
	} = $props();

	let imageOverlayEl: HTMLDivElement | undefined = $state();

	const linkRef = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.linkRef;

	// Props are stable for the editor's lifetime; the committer captures them
	// once on purpose — reactive values already cross as getters.
	// svelte-ignore state_referenced_locally
	const imageEdit = createImageEditCommitter({
		getDoc,
		getEditorEl,
		widgetSelection,
		controller,
		events,
		linkRef
	});

	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (target?.closest('[data-image-widget], [data-image-overlay]')) return;
			widgetSelection.clear();
		};
		root.addEventListener('pointerdown', handlePointerDown);
		return () => root.removeEventListener('pointerdown', handlePointerDown);
	});

	$effect(() => imageEdit.attachWidgetSelectListener());

	$effect(() => {
		widgetSelection.getSelected(); // re-run + reposition when the selected widget changes
		return imageEdit.syncOverlayToWidget(() => imageOverlayEl ?? null);
	});

	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		installWidgetRangePainter({
			editorRoot: root,
			getSelectionIsCustomRendered,
			getWidgetIsSelected: () => widgetSelection.getSelected() !== null,
			lifetime
		});
	});
</script>

<!-- Selecting an image stays (selection-class); the overlay is resize handles +
	properties popover — edit affordances — so reading mode never mounts it. -->
{#if widgetSelection.getSelected() && getPresentationMode() !== 'reading'}
	{@const sel = widgetSelection.getSelected()!}
	{@const ctx = imageEdit.getSelectedImageFields()}
	{#if ctx?.widgetEl}
		<div bind:this={imageOverlayEl} class="md-image-overlay" data-image-overlay>
			<ImageResizeHandles
				getWidgetEl={() => imageEdit.getSelectedImageFields()?.widgetEl ?? null}
				editorContentWidth={imageEdit.getEditorContentWidth()}
				editorEvents={events}
				onCommit={imageEdit.commitImageResize}
			/>
			{#key `${sel.paragraphPath.join(',')}@${sel.sourceStart}`}
				<ImageProperties
					target={sel}
					fields={imageFieldsFromInline(ctx.image)}
					buildBytes={imageEdit.buildEditBytes}
					onCommit={imageEdit.commitImageEdit}
					onDismiss={imageEdit.dismissImagePopover}
				/>
			{/key}
		</div>
	{/if}
{/if}
