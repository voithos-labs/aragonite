<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import type { Document, ImageFields } from '../../core/nodes';
	import type { PresentationMode } from '../../presentation-mode';
	import type { UndoController } from '../../editor-actions/deps';
	import type { GrammarView } from '../../schema/block-openers';
	import { EDITOR_DOC_KEY, type EditorDoc } from '../../editor-keys';
	import type { EditorEvents } from '../../editor-events';
	import { installWidgetRangePainter } from '../../selection/widget-range-paint';
	import ImageProperties from './ImageProperties.svelte';
	import ImageResizeHandles from './ImageResizeHandles.svelte';
	import { createImageEditCommitter } from './image-edit-commit';
	import { imageFieldsFromInline } from './image-source-bytes';
	import type { MenuPresence } from '../menu/menu-presence.svelte';
	import {
		pressLeavesImage,
		type WidgetSelectionState,
		type WidgetTarget
	} from './widget-selection-state.svelte';

	// Mounted unconditionally by Editor: the effects below must observe
	// widget-selection changes, so the selected-widget {#if} lives here.
	let {
		widgetSelection,
		controller,
		events,
		getDoc,
		getContentVersion,
		getEditorEl,
		getSelectionIsCustomRendered,
		getPresentationMode,
		grammar,
		lifetime,
		menuPresence
	}: {
		widgetSelection: WidgetSelectionState;
		controller: UndoController;
		events: EditorEvents;
		getDoc: () => Document;
		getContentVersion: () => number;
		getEditorEl: () => HTMLElement | null;
		getSelectionIsCustomRendered: () => boolean;
		getPresentationMode: () => PresentationMode;
		menuPresence: MenuPresence;
		grammar: GrammarView;
		lifetime: AbortSignal;
	} = $props();

	let imageOverlayEl: HTMLDivElement | undefined = $state();
	// While cropping, the pointer over the image belongs to the crop; the handle stands aside.
	let cropping = $state(false);

	const { linkRef } = getContext<EditorDoc>(EDITOR_DOC_KEY);

	// Props are stable for the editor's lifetime, so capturing once is deliberate:
	// reactive values already come in as getters.
	// svelte-ignore state_referenced_locally
	const imageEdit = createImageEditCommitter({
		getDoc,
		getEditorEl,
		widgetSelection,
		controller,
		events,
		linkRef,
		grammar
	});

	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		const handlePointerDown = (e: PointerEvent) => {
			if (pressLeavesImage(e, root)) widgetSelection.clear();
		};
		root.addEventListener('pointerdown', handlePointerDown);
		return () => root.removeEventListener('pointerdown', handlePointerDown);
	});

	$effect(() => imageEdit.attachWidgetSelectListener());
	// On every document change, so the selection is gone before a caret an undo or a commit
	// puts back reaches the selectionchange listener, which drops carets while it lives.
	$effect(() => {
		getContentVersion();
		untrack(imageEdit.clearStaleSelection);
	});

	// The popover's effects and cleanup can run once more after the selection or its image is
	// gone, before the branch that mounts it tears down, so they read the last live pair.
	let lastPopover: { target: WidgetTarget; fields: ImageFields } | null = null;
	const popover = $derived.by(() => {
		const target = widgetSelection.getSelected();
		const image = imageEdit.getSelectedImageFields()?.image;
		if (target && image) lastPopover = { target, fields: imageFieldsFromInline(image) };
		return lastPopover;
	});

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

<!-- Selecting an image stays available in reading mode; the overlay is a set of
	editing controls, so reading mode never mounts it. -->
{#if widgetSelection.getSelected() && getPresentationMode() !== 'reading'}
	{@const ctx = imageEdit.getSelectedImageFields()}
	{#if ctx?.widgetEl && popover}
		<div bind:this={imageOverlayEl} class="md-image-overlay" data-image-overlay>
			{#if !cropping}
				<ImageResizeHandles
					getWidgetEl={() => imageEdit.getSelectedImageFields()?.widgetEl ?? null}
					editorContentWidth={imageEdit.getEditorContentWidth()}
					editorEvents={events}
					onCommit={imageEdit.commitImageResize}
				/>
			{/if}
			{#key `${popover.target.paragraphPath.join(',')}@${popover.target.sourceStart}`}
				<ImageProperties
					target={popover.target}
					fields={popover.fields}
					getWidgetEl={() => imageEdit.getSelectedImageFields()?.widgetEl ?? null}
					buildBytes={imageEdit.buildEditBytes}
					onCommit={imageEdit.commitImageEdit}
					onRemove={imageEdit.removeImage}
					onDismiss={imageEdit.dismissImagePopover}
					maxFrameWidth={imageEdit.getEditorContentWidth}
					{menuPresence}
					bind:cropping
				/>
			{/key}
		</div>
	{/if}
{/if}
