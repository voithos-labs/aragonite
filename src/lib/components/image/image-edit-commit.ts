// What the image overlay writes and reads: the popover's field edits, a resize, a removal, and
// dropping a selected widget whose bytes are gone. Every write goes through the inline range write.

import { tick } from 'svelte';
import type { Document, ImageFields, InlineNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { InlineRangeCommit } from '../../editor-actions/inline-range-commit';
import type { EditorEvents } from '../../editor-events';
import { FALLBACK_CONTENT_WIDTH } from '../../windowing/typography-estimates';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import {
	buildImageEditBytes,
	imageFieldsFromInline,
	sameImageFields
} from '../../core/inline/image-source-bytes';
import { selectWidgetWhole } from '../../selection/place-caret';
import type { WidgetTarget } from '../../selection/primitives';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { CaretWriter } from '../../browser/caret-writer';
import { widgetElAt } from '../../caret/block-el-lookup';
import type { Reading } from '../../schema/reading';
import { widgetNodeIn, widgetSpanAt } from '../blocks/text/widget-adjacency';
import { observeResizeNow } from '../../windowing/observe-resize';

// ── Public API ──────────────────────────────────────────────────────────

export interface ImageEditCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	selection: SelectionState;
	caretWriter: CaretWriter;
	/** The editor's inline range write, which every popover edit goes through. */
	inlineRange: InlineRangeCommit;
	events: EditorEvents;
	/** How the editor reads its bytes: the image is found in the block as drawn, and the block's
	 *  own raw-write rule reads its grammar. */
	reading: Reading;
}

export interface SelectedImageFields {
	image: InlineNode;
	widgetEl: HTMLElement | null;
}

export interface ImageEditCommitter {
	getSelectedImageFields(): SelectedImageFields | null;
	/** Writes only if the image at `target` still reads as `seenFields`, the image the popover
	 *  last showed, so a draft never lands on another image. */
	commitImageEdit(target: WidgetTarget, seenFields: ImageFields, newFields: ImageFields): void;
	/** The bytes `commitImageEdit` would write, or `null` if it would refuse; the popover
	 *  compares against these to see whether anything changed. */
	buildEditBytes(target: WidgetTarget, newFields: ImageFields): string | null;
	commitImageResize(newWidth: number, newHeight: number | undefined): void;
	removeImage(target: WidgetTarget): void;
	dismissImagePopover(): void;
	getEditorContentWidth(): number;
	attachWidgetSelectListener(): () => void;
	/** Ends a selected widget once no widget starts at its bytes; commits to this image or to one
	 *  before it keep it selected. */
	clearStaleSelection(): void;
	syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void;
}

export function createImageEditCommitter(deps: ImageEditCommitterDeps): ImageEditCommitter {
	const { getDoc, getEditorEl, selection, inlineRange, events } = deps;

	const imageAt = (target: WidgetTarget): InlineNode | null => {
		const paragraph = blockNodeAt(getDoc(), target.paragraphPath);
		return paragraph ? findImageInParagraph(paragraph, target.sourceStart, deps.reading) : null;
	};

	// The bytes the last popover write moved, applied by the next stale check: the write runs as
	// the popover unmounts, where a read of the selection still returns the one before the click.
	let lastShift: { paragraphPath: number[]; editEnd: number; delta: number } | null = null;

	function getSelectedImageFields(): SelectedImageFields | null {
		const sel = selection.widget;
		const image = sel && imageAt(sel);
		if (!sel || !image) return null;
		const root = getEditorEl();
		return { image, widgetEl: root && widgetElAt(root, sel.paragraphPath, sel.sourceStart) };
	}

	function resolveEdit(
		target: WidgetTarget,
		newFields: ImageFields
	): { image: InlineNode; bytes: string } | null {
		const paragraph = blockNodeAt(getDoc(), target.paragraphPath);
		if (!paragraph) return null;
		const image = findImageInParagraph(paragraph, target.sourceStart, deps.reading);
		if (!image) return null;
		// Keep the reference form when the url and title are untouched: writing the resolved
		// url inline would leave the definition unused. Changing either is the user asking.
		const fields: ImageFields =
			image.label !== undefined && newFields.url === image.url && newFields.title === image.title
				? { ...newFields, label: image.label }
				: newFields;
		const bytes = buildImageEditBytes(image, paragraph.raw, fields);
		return bytes === null ? null : { image, bytes };
	}

	function buildEditBytes(target: WidgetTarget, newFields: ImageFields): string | null {
		return resolveEdit(target, newFields)?.bytes ?? null;
	}

	function commitImageEdit(
		target: WidgetTarget,
		seenFields: ImageFields,
		newFields: ImageFields
	): void {
		const image = imageAt(target);
		if (!image || !sameImageFields(imageFieldsFromInline(image), seenFields)) return;
		writeImageEdit(target, newFields);
	}

	// The caret from before the image was selected anchors the undo entry when no other caret
	// answers: the popover can commit after the selection has moved on.
	function writeImageEdit(target: WidgetTarget, newFields: ImageFields): void {
		const edit = resolveEdit(target, newFields);
		if (!edit) return;
		// Read from the bytes the block's kind will store, which a kind's own write rule can change.
		const delta = inlineRange.writtenDelta(
			target.paragraphPath,
			edit.image.start,
			edit.image.end,
			edit.bytes
		);
		if (delta !== 0) {
			lastShift = { paragraphPath: target.paragraphPath, editEnd: edit.image.end, delta };
		}
		void inlineRange.commitInlineRange(
			target.paragraphPath,
			edit.image.start,
			edit.image.end,
			edit.bytes,
			target.preSelectOffset
		);
	}

	function commitImageResize(newWidth: number, newHeight: number | undefined): void {
		const sel = selection.widget;
		if (!sel) return;
		const ctx = getSelectedImageFields();
		if (!ctx) return;
		const { image } = ctx;
		// A cropped frame keeps its shape through a resize: the height follows the width.
		const framedHeight =
			image.crop && image.width !== undefined && image.height !== undefined
				? Math.round((image.height * newWidth) / image.width)
				: newHeight;
		const newFields: ImageFields = {
			alt: image.alt ?? '',
			url: image.url ?? '',
			...(image.title !== undefined ? { title: image.title } : {}),
			width: newWidth,
			...(framedHeight !== undefined ? { height: framedHeight } : {}),
			...(image.crop !== undefined && framedHeight !== undefined ? { crop: image.crop } : {})
		};
		writeImageEdit(sel, newFields);
	}

	/** The whole `![...](...)` span goes and the caret lands where the image was, as a Delete on it
	 *  leaves it. The image stays selected until the write has begun, so undo reads its caret. */
	function removeImage(target: WidgetTarget): void {
		const image = imageAt(target);
		if (!image) return;
		void inlineRange.commitInlineRange(
			target.paragraphPath,
			image.start,
			image.end,
			'',
			image.start,
			{ landCaret: true }
		);
		selection.clearWidget();
	}

	function dismissImagePopover(): void {
		selection.clearWidget();
	}

	function getEditorContentWidth(): number {
		return getEditorEl()?.clientWidth ?? FALLBACK_CONTENT_WIDTH;
	}

	function attachWidgetSelectListener(): () => void {
		const root = getEditorEl();
		if (!root) return () => {};
		const handler = (e: Event) =>
			selectWidgetWhole(selection, deps.caretWriter, (e as CustomEvent).detail as WidgetTarget);
		root.addEventListener('image-widget-select', handler);
		return () => root.removeEventListener('image-widget-select', handler);
	}

	function clearStaleSelection(): void {
		const shift = lastShift;
		lastShift = null;
		if (!shift) {
			dropSelectionIfStale();
			return;
		}
		// The overlay finds the widget by the bytes its element names, so the move waits for the
		// block to render the write.
		void tick().then(() => {
			selection.followWidgetEdit(shift.paragraphPath, shift.editEnd, shift.delta);
			dropSelectionIfStale();
		});
	}

	function dropSelectionIfStale(): void {
		const sel = selection.widget;
		if (sel && !widgetSpanAt(getDoc(), sel, deps.reading)) selection.clearWidget();
	}

	function syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void {
		const noop = () => {};
		const overlayEl = getOverlay();
		const editorEl = getEditorEl();
		if (!overlayEl || !editorEl) return noop;

		// Each commit rebuilds the inline DOM, so the widget is re-resolved on every update and
		// the observer re-attached when it changes.
		let stopObserving: (() => void) | null = null;
		let observed: HTMLElement | null = null;

		const update = () => {
			const widgetEl = getSelectedImageFields()?.widgetEl;
			if (!widgetEl) return;
			if (widgetEl !== observed) {
				stopObserving?.();
				stopObserving = observeResizeNow(widgetEl, update);
				observed = widgetEl;
			}
			const wRect = widgetEl.getBoundingClientRect();
			const eRect = editorEl.getBoundingClientRect();
			const cs = getComputedStyle(editorEl);
			const borderTop = parseFloat(cs.borderTopWidth) || 0;
			const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
			overlayEl.style.top = `${wRect.top - eRect.top - borderTop + editorEl.scrollTop}px`;
			overlayEl.style.left = `${wRect.left - eRect.left - borderLeft + editorEl.scrollLeft}px`;
			overlayEl.style.width = `${wRect.width}px`;
			overlayEl.style.height = `${wRect.height}px`;
		};
		update();

		// Edits above the widget shift its y without resizing it.
		const unsubscribeEdit = events.on('edit', update);
		window.addEventListener('resize', update);

		// Sibling images settling shift the widget's y without resizing it; capture phase,
		// since neither event bubbles.
		const onImgSettle = (e: Event) => {
			if (e.target instanceof HTMLImageElement) update();
		};
		editorEl.addEventListener('load', onImgSettle, true);
		editorEl.addEventListener('error', onImgSettle, true);

		return () => {
			stopObserving?.();
			unsubscribeEdit();
			window.removeEventListener('resize', update);
			editorEl.removeEventListener('load', onImgSettle, true);
			editorEl.removeEventListener('error', onImgSettle, true);
		};
	}

	return {
		getSelectedImageFields,
		commitImageEdit,
		buildEditBytes,
		commitImageResize,
		removeImage,
		dismissImagePopover,
		getEditorContentWidth,
		attachWidgetSelectListener,
		clearStaleSelection,
		syncOverlayToWidget
	};
}

// ── Internal ────────────────────────────────────────────────────────────

// The overlay and the popover edit images only; any other widget selected whole reads as none.
function findImageInParagraph(
	para: NodeView,
	sourceStart: number,
	reading: Reading
): InlineNode | null {
	const widget = widgetNodeIn(para, sourceStart, reading);
	return widget?.kind === 'image' ? widget : null;
}
