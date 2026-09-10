<script lang="ts">
	import { untrack } from 'svelte';
	import type { ImageCrop, ImageFields } from '../../core/nodes';
	import { IMAGE_CHROME_SELECTOR, type WidgetTarget } from './widget-selection-state.svelte';
	import {
		IMAGE_ALT_FIELD,
		IMAGE_ALT_PLACEHOLDER,
		IMAGE_CROP,
		IMAGE_CROP_APPLY,
		IMAGE_CROP_CANCEL,
		IMAGE_PROPERTIES_LABEL,
		IMAGE_REMOVE
	} from '../../a11y-strings';
	import MenuIcon from '../menu/MenuIcon.svelte';
	import { DEFAULT_CROP, applyCropToWidget, panCrop, zoomCrop, type Size } from './image-crop';

	let {
		target,
		fields,
		getWidgetEl,
		buildBytes,
		onCommit,
		onRemove,
		onDismiss,
		maxFrameWidth,
		cropping = $bindable(false)
	}: {
		target: WidgetTarget;
		fields: ImageFields;
		getWidgetEl: () => HTMLElement | null;
		/** The popover's dirty check is a byte comparison, and the bytes are the write
		 *  seam's to decide. */
		buildBytes: (target: WidgetTarget, fields: ImageFields) => string | null;
		onCommit: (target: WidgetTarget, newFields: ImageFields) => void;
		onRemove: (target: WidgetTarget) => void;
		onDismiss: () => void;
		/** The column width: the widest frame a corner drag can open. */
		maxFrameWidth: () => number;
		cropping?: boolean;
	} = $props();

	// The URL has no field: a user who wants to retarget an image does it in source mode.
	let alt = $state(untrack(() => fields.alt));
	let fieldOpen = $state(false);
	let rootEl: HTMLDivElement | undefined = $state();
	let fieldInput: HTMLInputElement | undefined = $state();

	// The seed is the BYTES, not the fields object: a rebuild mints a fresh one per render, so
	// identity says nothing about whether the image moved.
	let seedBytes = $state(untrack(() => buildBytes(target, fields)));

	// The surface follows the document while it is open: an undo — or any write landing from
	// outside this gesture — moves the image past the draft, and the dismiss commit would put the
	// old bytes back. The in-flight draft is discarded rather than a committed change reverted.
	$effect(() => {
		const live = buildBytes(target, fields);
		if (live === seedBytes) return;
		seedBytes = live;
		alt = fields.alt;
	});

	$effect(() => {
		if (!rootEl) return;
		const handler = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (target?.closest(IMAGE_CHROME_SELECTOR)) return;
			onDismiss();
		};
		document.addEventListener('pointerdown', handler, true);
		return () => document.removeEventListener('pointerdown', handler, true);
	});

	// The commit runs in $effect cleanup so dismiss, image-switch (key change) and
	// programmatic clear all commit through one seam. A crop still open is abandoned, not
	// committed: only the tick writes one.
	$effect(() => {
		return () => {
			if (cropping) cancelCrop();
			commitIfChanged();
		};
	});

	$effect(() => {
		if (fieldOpen && fieldInput) fieldInput.focus();
	});

	// ── Alt ────────────────────────────────────────────────────────────────────

	// The title (`![alt](url "title")`) has no field: it is a tooltip nobody reads in an editor,
	// and an existing one rides through every commit untouched, as do the url, frame and crop.
	function draftFields(): ImageFields {
		return {
			alt,
			url: fields.url,
			...(fields.title !== undefined ? { title: fields.title } : {}),
			...(fields.width !== undefined ? { width: fields.width } : {}),
			...(fields.height !== undefined ? { height: fields.height } : {}),
			...(fields.crop !== undefined ? { crop: fields.crop } : {})
		};
	}

	function commitIfChanged() {
		const next = draftFields();
		const newBytes = buildBytes(target, next);
		if (newBytes === seedBytes) return;
		// Seeded now rather than when the write lands, so a blur and the unmount that follows
		// it cannot commit the same draft twice.
		seedBytes = newBytes;
		onCommit(target, next);
	}

	function toggleField() {
		if (fieldOpen) closeField(true);
		else fieldOpen = true;
	}

	function closeField(commit: boolean) {
		if (commit) commitIfChanged();
		else alt = fields.alt;
		fieldOpen = false;
	}

	function onFieldKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			closeField(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closeField(false);
		}
	}

	// ── Crop ───────────────────────────────────────────────────────────────────
	// limestone's cover crop: drag pans, the wheel zooms, corner brackets mark the frame, and
	// the tick writes it. The frame is the box the image has right now, so an unframed image
	// gains `|WxH` on its first crop.

	let draft = $state<ImageCrop>(DEFAULT_CROP);
	let frame: Size = { width: 0, height: 0 };
	let natural: Size = { width: 0, height: 0 };
	let snapshot: {
		widget: HTMLElement;
		img: HTMLImageElement;
		widgetStyle: string | null;
		imgStyle: string | null;
		cropped: boolean;
	} | null = null;
	let lastPointer: { x: number; y: number } | null = null;

	function startCrop() {
		const widget = getWidgetEl();
		const img = widget?.querySelector('img') ?? null;
		if (!widget || !img || img.naturalWidth === 0) return;
		if (fieldOpen) closeField(true);
		const box = widget.getBoundingClientRect();
		frame = { width: box.width, height: box.height };
		natural = { width: img.naturalWidth, height: img.naturalHeight };
		snapshot = {
			widget,
			img,
			widgetStyle: widget.getAttribute('style'),
			imgStyle: img.getAttribute('style'),
			cropped: widget.classList.contains('md-image-cropped')
		};
		draft = fields.crop ? { ...fields.crop } : { ...DEFAULT_CROP };
		applyCropToWidget(widget, img, frame, draft);
		cropping = true;
	}

	function paintDraft() {
		if (snapshot) applyCropToWidget(snapshot.widget, snapshot.img, frame, draft);
	}

	function restoreSnapshot() {
		if (!snapshot) return;
		const { widget, img, widgetStyle, imgStyle, cropped } = snapshot;
		if (widget.isConnected) {
			setStyle(widget, widgetStyle);
			setStyle(img, imgStyle);
			widget.classList.toggle('md-image-cropped', cropped);
		}
		snapshot = null;
	}

	function setStyle(el: HTMLElement, style: string | null) {
		if (style === null) el.removeAttribute('style');
		else el.setAttribute('style', style);
	}

	function cancelCrop() {
		restoreSnapshot();
		cropping = false;
	}

	function applyCrop() {
		const next: ImageFields = {
			...draftFields(),
			width: Math.round(frame.width),
			height: Math.round(frame.height),
			crop: draft
		};
		// The commit rebuilds the widget from the bytes; the preview styles go with the old DOM.
		snapshot = null;
		cropping = false;
		seedBytes = buildBytes(target, next);
		onCommit(target, next);
	}

	function onCropPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		lastPointer = { x: e.clientX, y: e.clientY };
	}

	function onCropPointerMove(e: PointerEvent) {
		if (!lastPointer) return;
		draft = panCrop(draft, e.clientX - lastPointer.x, e.clientY - lastPointer.y, frame, natural);
		lastPointer = { x: e.clientX, y: e.clientY };
		paintDraft();
	}

	function onCropPointerUp() {
		lastPointer = null;
	}

	function onCropWheel(e: WheelEvent) {
		e.preventDefault();
		draft = zoomCrop(draft, e.deltaY);
		paintDraft();
	}

	// The corner brackets resize the frame itself, which is what changes its aspect. The frame
	// is anchored where the image sits in the flow, so every corner moves the far edges: a
	// left-hand corner dragged inward shrinks the width the way the right-hand one dragged
	// inward does.
	type Corner = 'tl' | 'tr' | 'bl' | 'br';
	const MIN_FRAME = 32;
	let cornerDrag: { corner: Corner; startX: number; startY: number; start: Size } | null = null;

	function onCornerPointerDown(e: PointerEvent, corner: Corner) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		cornerDrag = { corner, startX: e.clientX, startY: e.clientY, start: { ...frame } };
	}

	function onCornerPointerMove(e: PointerEvent) {
		if (!cornerDrag) return;
		const { corner, startX, startY, start } = cornerDrag;
		const dx = (e.clientX - startX) * (corner === 'tl' || corner === 'bl' ? -1 : 1);
		const dy = (e.clientY - startY) * (corner === 'tl' || corner === 'tr' ? -1 : 1);
		const maxWidth = Math.max(MIN_FRAME, maxFrameWidth());
		frame = {
			width: Math.min(maxWidth, Math.max(MIN_FRAME, start.width + dx)),
			height: Math.max(MIN_FRAME, start.height + dy)
		};
		paintDraft();
	}

	function onCornerPointerUp(e: PointerEvent) {
		if (!cornerDrag) return;
		e.stopPropagation();
		cornerDrag = null;
	}

	// A double click on the picture is the crop gesture: the first click selects the image, so
	// by the second the toolbar (and this listener) is already mounted. On the document, since
	// each commit rebuilds the widget and a listener bound to one goes stale with it.
	$effect(() => {
		const onDoubleClick = (e: MouseEvent) => {
			if (cropping) return;
			const widget = getWidgetEl();
			if (!widget || !(e.target instanceof Node) || !widget.contains(e.target)) return;
			e.preventDefault();
			// The double click leaves a native range across the widget; a crop is not a text
			// gesture, so it goes.
			document.getSelection()?.removeAllRanges();
			startCrop();
		};
		document.addEventListener('dblclick', onDoubleClick);
		return () => document.removeEventListener('dblclick', onDoubleClick);
	});

	$effect(() => {
		if (!cropping) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancelCrop();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				applyCrop();
			}
		};
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	});

	// ── Placement ──────────────────────────────────────────────────────────────

	/** Beside the image, level with its top, when the viewport has room there; otherwise a row
	 *  inside the image's top-right corner, clamped to the viewport when the image itself runs
	 *  past it. Re-measured whenever the overlay re-anchors. */
	function keepBesideImage(node: HTMLElement): (() => void) | void {
		const place = () => {
			node.classList.remove('inside');
			node.style.left = '';
			const overlay = node.parentElement?.getBoundingClientRect();
			if (!overlay || node.getBoundingClientRect().right <= window.innerWidth - 8) return;
			node.classList.add('inside');
			const rightLimit = Math.min(overlay.right, window.innerWidth) - 8;
			const width = node.getBoundingClientRect().width;
			node.style.left = `${Math.max(0, rightLimit - width - overlay.left)}px`;
		};
		place();
		const overlay = node.parentElement;
		const observer = overlay ? new MutationObserver(place) : null;
		observer?.observe(overlay!, { attributes: true, attributeFilter: ['style'] });
		window.addEventListener('resize', place);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', place);
		};
	}

	/** The field hangs off the toolbar's far side; with no room there it hangs off the near one. */
	function keepFieldOnScreen(node: HTMLElement): void {
		const rect = node.getBoundingClientRect();
		if (rect.right > window.innerWidth - 8) node.classList.add('flipped');
	}

	function onRootKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !fieldOpen && !cropping) {
			e.preventDefault();
			onDismiss();
		}
	}
</script>

{#if cropping}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="md-image-crop-surface"
		onpointerdown={onCropPointerDown}
		onpointermove={onCropPointerMove}
		onpointerup={onCropPointerUp}
		onpointercancel={onCropPointerUp}
		onwheel={onCropWheel}
	>
		{#each ['tl', 'tr', 'bl', 'br'] as const as corner (corner)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="md-image-crop-corner {corner}"
				data-crop-corner={corner}
				onpointerdown={(e) => onCornerPointerDown(e, corner)}
				onpointermove={onCornerPointerMove}
				onpointerup={onCornerPointerUp}
				onpointercancel={onCornerPointerUp}
			></span>
		{/each}
	</div>
{/if}

<div
	bind:this={rootEl}
	class="md-image-properties"
	role="toolbar"
	aria-label={IMAGE_PROPERTIES_LABEL}
	tabindex="-1"
	onkeydown={onRootKeydown}
	{@attach keepBesideImage}
>
	{#if cropping}
		<button
			type="button"
			class="md-image-btn"
			aria-label={IMAGE_CROP_APPLY}
			title={IMAGE_CROP_APPLY}
			onclick={applyCrop}
		>
			<MenuIcon name="check" />
		</button>
		<button
			type="button"
			class="md-image-btn"
			aria-label={IMAGE_CROP_CANCEL}
			title={IMAGE_CROP_CANCEL}
			onclick={cancelCrop}
		>
			<MenuIcon name="x" />
		</button>
	{:else}
		<button
			type="button"
			class="md-image-btn"
			class:active={fieldOpen}
			class:set={alt.length > 0}
			aria-label={IMAGE_ALT_FIELD}
			aria-pressed={fieldOpen}
			title={IMAGE_ALT_FIELD}
			onclick={toggleField}
		>
			<MenuIcon name="captions" />
		</button>
		<button
			type="button"
			class="md-image-btn"
			aria-label={IMAGE_CROP}
			title="{IMAGE_CROP} — or double-click it"
			onclick={startCrop}
		>
			<MenuIcon name="crop" />
		</button>
		<button
			type="button"
			class="md-image-btn"
			aria-label={IMAGE_REMOVE}
			title={IMAGE_REMOVE}
			onclick={() => onRemove(target)}
		>
			<MenuIcon name="trash" />
		</button>
	{/if}
	{#if fieldOpen}
		<label class="md-image-field" {@attach keepFieldOnScreen}>
			<span class="md-image-field-label">Alt</span>
			<input
				type="text"
				bind:this={fieldInput}
				bind:value={alt}
				aria-label={IMAGE_ALT_FIELD}
				placeholder={IMAGE_ALT_PLACEHOLDER}
				onkeydown={onFieldKeydown}
			/>
		</label>
	{/if}
</div>

<style>
	/* limestone's cover actions: a stack of small surface buttons beside the image, level with
	   its top. `inside` (no room beside) lays them as a row in the image's top-right corner. */
	.md-image-properties {
		position: absolute;
		top: 0;
		left: calc(100% + 8px);
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 100;
		outline: none;
		font-family: var(--font-ui, system-ui, sans-serif);
	}
	.md-image-properties.inside {
		top: 8px;
		flex-direction: row;
	}
	.md-image-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: var(--color-bg, #2c2c2a);
		color: var(--color-text-secondary, #cfcfca);
		cursor: pointer;
		box-shadow: var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
	}
	.md-image-btn:hover,
	.md-image-btn.active,
	.md-image-btn.set {
		color: var(--color-text-primary, #e8e8e5);
	}
	.md-image-btn.active {
		background: var(--color-surface, #2d3033);
	}

	/* The alt field, hung off the toolbar's far side on the menu surface: a caption over its
	   input, the way a properties row reads, rather than a label beside a box. */
	.md-image-field {
		position: absolute;
		top: 0;
		left: calc(100% + 6px);
		width: 240px;
		padding: 8px 10px 10px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 5px;
		background: var(--color-bg, #2c2c2a);
		border: 1px solid var(--color-border, #3e3e3b);
		border-radius: 8px;
		box-shadow: var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35));
	}
	.md-image-field.flipped {
		left: auto;
		right: calc(100% + 6px);
	}
	.inside .md-image-field {
		left: auto;
		right: 0;
		top: calc(100% + 6px);
	}
	.md-image-field-label {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted, #aaaaaa);
	}

	/* Underlined, not boxed: one rule under the text reads as a field to fill in and keeps the
	   surface calm, where a second rounded box inside a rounded card reads as chrome on chrome. */
	.md-image-field input {
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
	.md-image-field input:focus {
		border-bottom-color: var(--color-accent, #567b67);
	}
	.md-image-field input::placeholder {
		color: var(--color-text-muted, #aaaaaa);
	}

	/* The crop session: the whole image is a pan surface, bracketed at the corners. */
	.md-image-crop-surface {
		position: absolute;
		inset: 0;
		cursor: grab;
		touch-action: none;
		z-index: 20;
	}
	.md-image-crop-surface:active {
		cursor: grabbing;
	}
	/* The brackets are the frame's own handles: dragging one resizes the frame. */
	.md-image-crop-corner {
		position: absolute;
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.9);
		filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
		touch-action: none;
	}
	.md-image-crop-corner::before {
		content: '';
		position: absolute;
		inset: -8px;
	}
	.md-image-crop-corner.tl {
		top: 8px;
		left: 8px;
		border-right: none;
		border-bottom: none;
		cursor: nwse-resize;
	}
	.md-image-crop-corner.tr {
		top: 8px;
		right: 8px;
		border-left: none;
		border-bottom: none;
		cursor: nesw-resize;
	}
	.md-image-crop-corner.bl {
		bottom: 8px;
		left: 8px;
		border-right: none;
		border-top: none;
		cursor: nesw-resize;
	}
	.md-image-crop-corner.br {
		bottom: 8px;
		right: 8px;
		border-left: none;
		border-top: none;
		cursor: nwse-resize;
	}
</style>
