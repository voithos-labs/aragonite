<script lang="ts">
	/**
	 * A touch screen's selection handles; `selection-handles.ts` says where they stand. Pointer
	 * chrome a finger drags, so hidden from assistive tech and out of the tab order, and placed in the
	 * root's scrolled content so a handle scrolls with its text.
	 */
	import { getContext, tick } from 'svelte';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../../editor-keys';
	import { normalize, type EditorSelection } from '../../selection/primitives';
	import { POINTER_GESTURE_ATTR } from '../../selection/pointer-gesture';
	import { observeResize } from '../../windowing/observe-resize';
	import {
		handleSpots,
		startHandleDrag,
		type HandleRange,
		type HandleSpot
	} from './selection-handles';

	let {
		finger,
		getSelection
	}: { finger: () => boolean; getSelection: () => EditorSelection | null } = $props();

	const services = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const editorDoc = getContext<EditorDoc>(EDITOR_DOC_KEY);

	// The hit box is a fingertip; the dot drawn inside it is smaller.
	const BOX = 44;
	const EDGE_GAP = 40;

	let range: HandleRange | null = null;
	let shown: (HandleSpot & { left: number; top: number })[] = $state([]);
	let changes = $state(0);
	$effect(() => services.events.on('selectionChange', () => changes++));

	function currentRange(): HandleRange | null {
		const { selection } = services;
		if (selection.isCustomRendered && selection.start && selection.end) {
			return { start: selection.start, end: selection.end, painted: true };
		}
		const live = getSelection();
		return live && { ...normalize(live), painted: false };
	}

	// An end handle hangs below its point, an edge handle beside the browser's own: right of an end
	// at the line's middle, above and right of a start.
	function place(spot: HandleSpot): { left: number; top: number } {
		if (!spot.edge) return { left: spot.end === 'start' ? spot.x - BOX : spot.x, top: spot.bottom };
		return spot.end === 'end'
			? { left: spot.x + EDGE_GAP - BOX / 2, top: spot.y - BOX / 2 }
			: { left: spot.x, top: spot.top - BOX };
	}

	$effect(() => {
		void changes;
		const root = editorDoc.editorRoot();
		if (!root || !finger()) {
			range = null;
			shown = [];
			return;
		}
		const at = root;
		function measure(): void {
			range = currentRange();
			const origin = at.getBoundingClientRect();
			const dx = at.scrollLeft - origin.left - at.clientLeft;
			const dy = at.scrollTop - origin.top - at.clientTop;
			shown = handleSpots(
				range,
				services.rects,
				(p) => services.selection.cellLandingFor(p).path
			).map((spot) => {
				const { left, top } = place(spot);
				return { ...spot, left: left + dx, top: top + dy };
			});
		}
		let live = true;
		// The blocks write the range in their own effects, so the first read waits for their flush.
		(async () => {
			await tick();
			if (live) measure();
		})();
		// A scroll can mount an end's block, and an inner scroll moves its text.
		window.addEventListener('scroll', measure, { capture: true, passive: true });
		const stopResize = observeResize(at, measure);
		return () => {
			live = false;
			window.removeEventListener('scroll', measure, { capture: true });
			stopResize();
		};
	});

	function press(e: PointerEvent, spot: HandleSpot): void {
		const root = editorDoc.editorRoot();
		if (!range || !root || e.button !== 0) return;
		e.preventDefault();
		startHandleDrag(e, spot, range, {
			editorRoot: root,
			scrollContainer: editorDoc.scrollHost() ?? root,
			selection: services.selection,
			caretWriter: services.caretWriter,
			getBlockElByPath: editorDoc.blockElLookup,
			lifetimeSignal: editorDoc.lifetime
		});
	}

	const ownPresses = { [POINTER_GESTURE_ATTR]: '' };
</script>

{#each shown as spot (spot.end)}
	<div
		class="selection-handle selection-handle-{spot.end}"
		class:selection-handle-edge={spot.edge}
		data-handle={spot.end}
		aria-hidden="true"
		{...ownPresses}
		style="left: {spot.left}px; top: {spot.top}px;"
		onpointerdown={(e) => press(e, spot)}
	></div>
{/each}

<style>
	.selection-handle {
		position: absolute;
		width: 44px;
		height: 44px;
		/* Above an open menu, which a press on a handle closes like any press outside it. */
		z-index: 2001;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.selection-handle::after {
		content: '';
		position: absolute;
		top: 0;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--md-color-selection, #567b67);
	}
	.selection-handle-start::after {
		right: 0;
		border-top-right-radius: 0;
	}
	.selection-handle-end::after {
		left: 0;
		border-top-left-radius: 0;
	}
	.selection-handle-edge::after {
		inset: 12px;
		border-radius: 50%;
	}
</style>
