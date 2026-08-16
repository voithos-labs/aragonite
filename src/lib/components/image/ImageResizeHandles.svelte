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

	// `md-image-broken` is toggled imperatively on the widget, which Svelte doesn't
	// track, so a MutationObserver mirrors it into reactive state. Each commit rebuilds
	// the widget DOM, so the observer re-attaches on every edit event.
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

	function startDrag(e: PointerEvent) {
		const img = imgEl();
		if (!img) return;
		const { width: startWidth, height: startHeight } = img.getBoundingClientRect();
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
			aspectLocked: !e.shiftKey,
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
		const img = imgEl();
		if (!img) return;
		img.style.width = `${snapped}px`;
		// Shift unlocks the aspect: the height stays where the user found it and the image
		// distorts. Locked, the stylesheet's `height: auto` derives it from the new width.
		img.style.height = dragState.aspectLocked ? '' : `${dragState.startHeight}px`;
	}

	function endDrag(e: PointerEvent) {
		if (!dragState) return;
		const finalWidth = dragState.currentWidth;
		const startWidth = dragState.startWidth;
		const aspectLocked = dragState.aspectLocked;
		const naturalW = dragState.naturalWidth;
		const startHeight = dragState.startHeight;
		const startX = dragState.startX;
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
				naturalWidth: naturalW,
				imgRectWidth: imgEl()?.getBoundingClientRect().width,
				imgWidthAttr: imgEl()?.getAttribute('width')
			});
		}
		onCommit(Math.round(finalWidth), resolveDraggedHeight(aspectLocked, startHeight));
	}

	function cancelDrag(e: PointerEvent) {
		if (!dragState) return;
		// Fall back to the widget's committed width/height attributes.
		const img = imgEl();
		if (img) {
			img.style.width = '';
			img.style.height = '';
		}
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
	}
</script>

{#if !isBroken}
	<div
		class="md-resize-handle md-resize-handle-right"
		role="presentation"
		onpointerdown={startDrag}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={cancelDrag}
	></div>
	<div
		class="md-resize-handle md-resize-handle-corner"
		role="presentation"
		onpointerdown={startDrag}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={cancelDrag}
	></div>
{/if}

<style>
	.md-resize-handle {
		position: absolute;
		width: 8px;
		height: 8px;
		background: var(--color-accent, #567b67);
		border: 1px solid #fff;
		z-index: 10;
		cursor: ew-resize;
	}
	.md-resize-handle-right {
		right: -4px;
		top: 50%;
		transform: translateY(-50%);
	}
	.md-resize-handle-corner {
		right: -4px;
		bottom: -4px;
		cursor: nwse-resize;
	}
</style>
