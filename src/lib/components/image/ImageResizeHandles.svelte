<script lang="ts">
	import type { EditorEvents } from '../../editor-events';
	import { clampWidth, snapWidth, resolveDraggedHeight, MIN_WIDTH } from './image-resize';
	import { devWarn } from '../../dev-warn';

	let {
		getWidgetEl,
		editorContentWidth,
		editorEvents,
		onCommit
	}: {
		getWidgetEl: () => HTMLElement | null;
		editorContentWidth: number;
		editorEvents: EditorEvents;
		onCommit: (newWidth: number, newHeight: number | undefined) => void;
	} = $props();

	const SNAP_THRESHOLD_PX = 12;

	let dragState: {
		startX: number;
		startWidth: number;
		startHeight: number;
		naturalWidth: number;
		aspectLocked: boolean;
		currentWidth: number;
	} | null = $state(null);

	// Mirrors the widget's `md-image-broken` class into state; re-attached on every edit, since
	// each commit rebuilds the widget.
	let isBroken = $state(false);
	$effect(() => {
		let observer: MutationObserver | null = null;
		let observed: HTMLElement | null = null;

		const reattach = () => {
			const widget = getWidgetEl();
			if (widget === observed) return;
			observer?.disconnect();
			if (!widget) {
				observer = null;
				observed = null;
				isBroken = false;
				return;
			}
			isBroken = widget.classList.contains('md-image-broken');
			observer = new MutationObserver(() => {
				isBroken = widget.classList.contains('md-image-broken');
			});
			observer.observe(widget, { attributes: true, attributeFilter: ['class'] });
			observed = widget;
		};

		reattach();
		const unsub = editorEvents.on('edit', reattach);
		return () => {
			observer?.disconnect();
			unsub();
		};
	});

	function imgEl(): HTMLImageElement | null {
		return getWidgetEl()?.querySelector('img') ?? null;
	}

	// A cropped image resizes its frame (the widget), not the `<img>` panned inside it, which
	// would bulge out of the frame and, zoomed, start the drag from the wrong width.
	function isCropped(): boolean {
		return getWidgetEl()?.classList.contains('md-image-cropped') ?? false;
	}

	function previewEl(): HTMLElement | null {
		return isCropped() ? getWidgetEl() : imgEl();
	}

	function startDrag(e: PointerEvent) {
		const img = imgEl();
		const preview = previewEl();
		if (!img || !preview) return;
		const { width: startWidth, height: startHeight } = preview.getBoundingClientRect();
		// Unmeasurable width makes every snap run against 0 and commit a tiny image
		// whichever way the drag goes; bail before pointer capture.
		if (startWidth < MIN_WIDTH || editorContentWidth < MIN_WIDTH) return;
		e.preventDefault();
		e.stopPropagation();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		dragState = {
			startX: e.clientX,
			startWidth,
			startHeight,
			naturalWidth: img.naturalWidth,
			// A crop's frame keeps its shape through a resize (`commitImageResize` derives the
			// height from it), so Shift has nothing to unlock here; the corner brackets shown
			// while cropping are where a frame's shape changes.
			aspectLocked: isCropped() || !e.shiftKey,
			currentWidth: startWidth
		};
	}

	function moveDrag(e: PointerEvent) {
		if (!dragState) return;
		// Reflow mid-drag (a sibling image settling, a scrollbar appearing) can
		// transiently zero the content width; hold the last good width instead of
		// snapping the image to nothing.
		if (editorContentWidth < MIN_WIDTH) return;
		const dx = e.clientX - dragState.startX;
		const proposed = dragState.startWidth + dx;
		const clamped = clampWidth(proposed, editorContentWidth);
		const snapped = snapWidth(clamped, editorContentWidth, SNAP_THRESHOLD_PX);
		dragState.currentWidth = snapped;
		const preview = previewEl();
		if (!preview) return;
		preview.style.width = `${snapped}px`;
		// Shift unlocks the aspect: the height stays where the user found it and the image
		// distorts. Locked, the frame's own `aspect-ratio` (cropped) or the stylesheet's
		// `height: auto` (plain) derives it from the new width.
		preview.style.height = dragState.aspectLocked ? '' : `${dragState.startHeight}px`;
	}

	function endDrag(e: PointerEvent) {
		if (!dragState) return;
		const {
			currentWidth: finalWidth,
			startWidth,
			startHeight,
			startX,
			aspectLocked,
			naturalWidth
		} = dragState;
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		// Click-and-release with no drag: skip commit so undo stack stays clean.
		if (Math.abs(finalWidth - startWidth) < 1) return;
		// Report the "image suddenly becomes tiny on release" symptom with the upstream
		// signals that would explain it, so the next occurrence is diagnosable.
		if (finalWidth <= MIN_WIDTH && Math.abs(e.clientX - startX) > 50) {
			devWarn('image-resize', 'suspicious commit', {
				startWidth,
				finalWidth,
				dx: e.clientX - startX,
				editorContentWidth,
				naturalWidth,
				imgRectWidth: previewEl()?.getBoundingClientRect().width,
				imgWidthAttr: imgEl()?.getAttribute('width')
			});
		}
		onCommit(Math.round(finalWidth), resolveDraggedHeight(aspectLocked, startHeight));
	}

	/** The frame's committed width, from the `|WxH` hint the widget was built with. */
	function restoreFrameWidth(widget: HTMLElement): void {
		const width = imgEl()?.getAttribute('width');
		if (width) widget.style.width = `${width}px`;
	}

	function cancelDrag(e: PointerEvent) {
		if (!dragState) return;
		// Fall back to the committed geometry: the widget's width/height attributes, or for a
		// cropped image the frame width `applyCropToWidget` wrote.
		const preview = previewEl();
		if (preview) {
			preview.style.height = '';
			if (preview === imgEl()) preview.style.width = '';
			else restoreFrameWidth(preview);
		}
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
	}
</script>

<!-- One handle, on the right edge: width is the only thing a drag sets (Shift unlocks the
	aspect ratio), so a second corner handle would be the same gesture twice. -->
{#if !isBroken}
	<div
		class="md-resize-handle md-resize-handle-right"
		role="presentation"
		onpointerdown={startDrag}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={cancelDrag}
	></div>
{/if}

<style>
	/* White over a hairline rim, inside the right edge, so it shows on any picture without
	   competing with the accent selection ring; on an icon-sized image it moves outside the edge. */
	.md-resize-handle {
		position: absolute;
		right: clamp(-3px, calc(50% - 20px), 7px);
		top: 50%;
		width: 4px;
		height: 36px;
		max-height: 40%;
		transform: translateY(-50%);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.92);
		box-shadow:
			0 0 0 0.5px rgba(0, 0, 0, 0.35),
			0 1px 3px rgba(0, 0, 0, 0.35);
		opacity: 0.85;
		z-index: 10;
		cursor: ew-resize;
	}
	.md-resize-handle:hover {
		opacity: 1;
	}
	.md-resize-handle::before {
		content: '';
		position: absolute;
		inset: -6px -8px;
	}
</style>
