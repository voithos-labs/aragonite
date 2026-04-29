<script lang="ts">
	import { clampWidth, snapWidth, resolveAspectLockedHeight } from './image-resize';

	let {
		widgetEl,
		editorContentWidth,
		onCommit
	}: {
		widgetEl: HTMLElement;
		editorContentWidth: number;
		onCommit: (newWidth: number, newHeight: number | undefined) => void;
	} = $props();

	const SNAP_THRESHOLD_PX = 12;

	let dragState: {
		startX: number;
		startWidth: number;
		naturalWidth: number;
		naturalHeight: number;
		aspectLocked: boolean;
		currentWidth: number;
	} | null = $state(null);

	function imgEl(): HTMLImageElement | null {
		return widgetEl.querySelector('img');
	}

	function startDrag(e: PointerEvent) {
		const img = imgEl();
		if (!img) return;
		e.preventDefault();
		e.stopPropagation();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		dragState = {
			startX: e.clientX,
			startWidth: img.getBoundingClientRect().width,
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
			aspectLocked: !e.shiftKey,
			currentWidth: img.getBoundingClientRect().width
		};
	}

	function moveDrag(e: PointerEvent) {
		if (!dragState) return;
		const dx = e.clientX - dragState.startX;
		const proposed = dragState.startWidth + dx;
		const clamped = clampWidth(proposed, editorContentWidth);
		const snapped = snapWidth(clamped, editorContentWidth, SNAP_THRESHOLD_PX);
		dragState.currentWidth = snapped;
		const img = imgEl();
		if (!img) return;
		img.style.width = `${snapped}px`;
		if (dragState.aspectLocked && dragState.naturalWidth > 0) {
			const h = resolveAspectLockedHeight(snapped, dragState.naturalWidth, dragState.naturalHeight);
			img.style.height = `${h}px`;
		}
	}

	function endDrag(e: PointerEvent) {
		if (!dragState) return;
		const finalWidth = dragState.currentWidth;
		const startWidth = dragState.startWidth;
		const aspectLocked = dragState.aspectLocked;
		const naturalW = dragState.naturalWidth;
		const naturalH = dragState.naturalHeight;
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		// Click-and-release with no drag: skip commit so undo stack stays clean.
		if (Math.abs(finalWidth - startWidth) < 1) return;
		const newHeight = aspectLocked
			? resolveAspectLockedHeight(finalWidth, naturalW, naturalH)
			: undefined;
		onCommit(Math.round(finalWidth), newHeight);
	}

	function cancelDrag(e: PointerEvent) {
		if (!dragState) return;
		// Clear inline styles so the widget falls back to its committed width/height attributes.
		const img = imgEl();
		if (img) {
			img.style.width = '';
			img.style.height = '';
		}
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
	}
</script>

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

<style>
	.md-resize-handle {
		position: absolute;
		width: 8px;
		height: 8px;
		background: var(--color-accent, #4a9eff);
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
