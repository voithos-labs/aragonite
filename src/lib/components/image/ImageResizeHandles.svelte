<script lang="ts">
	import type { EditorEvents } from '../../editor-events';
	import { clampWidth, snapWidth, resolveAspectLockedHeight, MIN_WIDTH } from './image-resize';
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
		naturalWidth: number;
		naturalHeight: number;
		aspectLocked: boolean;
		currentWidth: number;
	} | null = $state(null);

	// `md-image-broken` is toggled imperatively on the widget when the underlying
	// `<img>` fires `error` / `load`; Svelte 5 doesn't track external class
	// mutations, so a MutationObserver mirrors them into reactive state. Each
	// commit rebuilds the widget DOM via text-render's `replaceChildren`, so
	// the observer re-attaches to the current widget on every edit event.
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
		const startWidth = img.getBoundingClientRect().width;
		// If we can't measure the current width, every snap math runs against 0 and
		// commits a tiny image regardless of drag direction. Bail before pointer capture.
		if (startWidth < MIN_WIDTH || editorContentWidth < MIN_WIDTH) return;
		e.preventDefault();
		e.stopPropagation();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		dragState = {
			startX: e.clientX,
			startWidth,
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
			aspectLocked: !e.shiftKey,
			currentWidth: startWidth
		};
	}

	function moveDrag(e: PointerEvent) {
		if (!dragState) return;
		// Editor reflow mid-drag (sibling image settling, scrollbar appearing) can
		// transiently zero the content width; writing snap-to-0 mid-drag would jump
		// the image tiny. Hold the last good width until the next move.
		if (editorContentWidth < MIN_WIDTH) return;
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
		const startX = dragState.startX;
		dragState = null;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		// Click-and-release with no drag: skip commit so undo stack stays clean.
		if (Math.abs(finalWidth - startWidth) < 1) return;
		// Surface the "image suddenly becomes tiny on release" symptom with the
		// upstream signals that would explain it (editorContentWidth=0, etc.) so
		// the next occurrence is diagnosable without guessing.
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
		// Aspect-locked drag persists `|N` (renderer derives height from natural aspect);
		// only an unlocked drag writes the explicit `|NxM` form.
		const newHeight = aspectLocked
			? undefined
			: resolveAspectLockedHeight(finalWidth, naturalW, naturalH);
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
