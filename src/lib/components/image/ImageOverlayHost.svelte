<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import type { Document, ImageFields } from '../../core/nodes';
	import type { InlineRangeCommit } from '../../editor-actions/inline-range-commit';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../../editor-keys';
	import type { EditorEvents } from '../../editor-events';
	import {
		installWidgetSelectionPainter,
		type WidgetSelectionPainter
	} from '../../selection/widget-selection-paint';
	import ImageProperties from './ImageProperties.svelte';
	import ImageResizeHandles from './ImageResizeHandles.svelte';
	import { createImageEditCommitter } from './image-edit-commit';
	import { imageFieldsFromInline } from '../../core/inline/image-source-bytes';
	import type { MenuPresence } from '../menu/menu-presence.svelte';
	import { pressLeavesImage } from './image-press';
	import { isSecondaryPress, pressesSelectedWidget } from '../../selection/widget-press';
	import { clearOnPress } from '../../selection/pointer-gesture';
	import type { WidgetTarget } from '../../selection/primitives';
	import type { CaretRestore } from '../../selection/caret-restore';

	// Mounted unconditionally by Editor: the effects below must observe the selected widget
	// changing, so the overlay's {#if} lives here.
	let {
		inlineRange,
		events,
		getDoc,
		getContentVersion,
		getEditorEl,
		lifetime,
		menuPresence,
		fieldCaret,
		editorTakesChord
	}: {
		inlineRange: InlineRangeCommit;
		events: EditorEvents;
		getDoc: () => Document;
		getContentVersion: () => number;
		getEditorEl: () => HTMLElement | null;
		menuPresence: MenuPresence;
		lifetime: AbortSignal;
		/** Puts focus back on the selected image once its alt field, which borrows it, closes. */
		fieldCaret: CaretRestore;
		/** The editor's own chords, which a crop keeps from writing over the image. */
		editorTakesChord: (e: KeyboardEvent) => boolean;
	} = $props();

	let imageOverlayEl: HTMLDivElement | undefined = $state();
	// While cropping, the pointer over the image belongs to the crop; the resize handle yields.
	let cropping = $state(false);

	const { reading } = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const { selection, caretWriter } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	// Captured once: props are stable for the editor's lifetime, and reactive ones are getters.
	// svelte-ignore state_referenced_locally
	const imageEdit = createImageEditCommitter({
		getDoc,
		getEditorEl,
		selection,
		caretWriter,
		inlineRange,
		events,
		reading
	});

	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		const handlePointerDown = (e: PointerEvent) => {
			// A right-click on the held widget keeps it for the menu's rows, as one on a range does.
			if (isSecondaryPress(e) && pressesSelectedWidget(selection, e.target)) return;
			if (selection.widget !== null && pressLeavesImage(e, root))
				clearOnPress(e, lifetime, { selection: () => selection.clearWidget() });
		};
		root.addEventListener('pointerdown', handlePointerDown);
		return () => root.removeEventListener('pointerdown', handlePointerDown);
	});

	$effect(() => imageEdit.attachWidgetSelectListener());
	// On every document change: an image a popover write moved follows its bytes, and a selected
	// widget of any kind whose bytes are gone stops being selected.
	$effect(() => {
		getContentVersion();
		untrack(imageEdit.clearStaleSelection);
	});

	// The popover's effects and cleanup can run once more after the selection or its image is
	// gone, before the branch that mounts it tears down, so they read the last live pair.
	let lastPopover: { target: WidgetTarget; fields: ImageFields } | null = null;
	const popover = $derived.by(() => {
		const target = selection.widget;
		const image = imageEdit.getSelectedImageFields()?.image;
		if (target && image) lastPopover = { target, fields: imageFieldsFromInline(image) };
		return lastPopover;
	});

	// Selecting an image stays available in reading mode; the overlay is a set of editing controls,
	// so reading mode never mounts it, and the image wears the selection wash instead of its ring.
	const overlayShown = $derived(
		selection.widget !== null &&
			reading.mode() !== 'reading' &&
			!!imageEdit.getSelectedImageFields()?.widgetEl &&
			popover !== null
	);

	$effect(() => {
		void selection.widget; // re-run + reposition when the selected widget changes
		return imageEdit.syncOverlayToWidget(() => imageOverlayEl ?? null);
	});

	let widgetPainter: WidgetSelectionPainter | null = null;
	$effect(() => {
		const root = getEditorEl();
		if (!root) return;
		widgetPainter = installWidgetSelectionPainter({
			editorRoot: root,
			getSelectionIsCustomRendered: () => selection.isCustomRendered,
			getHeldWidget: () => selection.widget,
			getHeldWidgetDrawnElsewhere: () => overlayShown,
			lifetime
		});
	});
	// A re-render rebuilds the widget's element without the class, and fires no `selectionchange`.
	$effect(() => {
		void [selection.widget, overlayShown, getContentVersion()];
		untrack(() => widgetPainter?.repaint());
	});
</script>

{#if overlayShown && popover}
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
				{caretWriter}
				{fieldCaret}
				{editorTakesChord}
				bind:cropping
			/>
		{/key}
	</div>
{/if}
