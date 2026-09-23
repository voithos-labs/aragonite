import { resolvedInlineContent } from '../../core/inline/inline-cache';
import { flattenInlineWidgets } from '../../core/inline/inline-widgets';
import type { Document, ImageFields, InlineNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { LinkReferenceResolverRef } from '../../editor-keys';
import type { UndoController } from '../../editor-actions/deps';
import { createInlineRangeCommit } from '../../editor-actions/inline-range-commit';
import type { EditorEvents } from '../../editor-events';
import type { GrammarView } from '../../schema/block-openers';
import { FALLBACK_CONTENT_WIDTH } from '../../cursor/typography-estimates';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { buildImageEditBytes, imageFieldsFromInline, sameImageFields } from './image-source-bytes';
import type { WidgetSelectionState, WidgetTarget } from './widget-selection-state.svelte';

// ── Public API ──────────────────────────────────────────────────────────

/** The image `target` names in `doc`, or null once no image starts at its bytes. */
export function imageAtTarget(
	doc: Document,
	target: WidgetTarget,
	linkRef?: LinkReferenceResolverRef
): InlineNode | null {
	const paragraph = blockNodeAt(doc, target.paragraphPath);
	return paragraph ? findImageInParagraph(paragraph, target.sourceStart, linkRef) : null;
}

export interface ImageEditCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
	events: EditorEvents;
	linkRef?: LinkReferenceResolverRef;
	/** This editor's grammar, for the block's own raw-write rule. Absent means the global one. */
	grammar?: GrammarView;
}

export interface SelectedImageFields {
	image: InlineNode;
	widgetEl: HTMLElement | null;
}

export interface ImageEditCommitter {
	getSelectedImageFields(): SelectedImageFields | null;
	/**
	 * The popover's write. `target` and `seenFields` are the image the popover last showed, not
	 * the live selection; nothing is written unless the image at `target` still reads as
	 * `seenFields`, so a draft never lands on another image, even after a document swap.
	 */
	commitImageEdit(target: WidgetTarget, seenFields: ImageFields, newFields: ImageFields): void;
	/** The bytes `commitImageEdit` would write, or `null` if it would refuse; the popover
	 *  compares against these to see whether anything changed. */
	buildEditBytes(target: WidgetTarget, newFields: ImageFields): string | null;
	commitImageResize(newWidth: number, newHeight: number | undefined): void;
	removeImage(target: WidgetTarget): void;
	dismissImagePopover(): void;
	getEditorContentWidth(): number;
	attachWidgetSelectListener(): () => void;
	/** Clears the widget selection when the document no longer holds an image at its bytes; the
	 *  image's own commits keep its start byte, so they keep it selected. */
	clearStaleSelection(): void;
	syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void;
}

export function createImageEditCommitter(deps: ImageEditCommitterDeps): ImageEditCommitter {
	const { getDoc, getEditorEl, widgetSelection, controller, events } = deps;
	const inlineRange = createInlineRangeCommit({ getDoc, controller, grammar: deps.grammar });

	function queryWidgetEl(paragraphPath: number[], sourceStart: number): HTMLElement | null {
		const root = getEditorEl();
		if (!root) return null;
		// Locate by the live block-host path, never an attribute baked into the widget:
		// see widget-dom.ts's click handler.
		const host = root.querySelector(`[data-block-path='${JSON.stringify(paragraphPath)}']`);
		if (!host) return null;
		return host.querySelector(
			`[data-image-widget][data-source-start="${sourceStart}"]`
		) as HTMLElement | null;
	}

	const imageAt = (target: WidgetTarget): InlineNode | null =>
		imageAtTarget(getDoc(), target, deps.linkRef);

	function getSelectedImageFields(): SelectedImageFields | null {
		const sel = widgetSelection.getSelected();
		const image = sel && imageAt(sel);
		if (!sel || !image) return null;
		return { image, widgetEl: queryWidgetEl(sel.paragraphPath, sel.sourceStart) };
	}

	function resolveEdit(
		target: WidgetTarget,
		newFields: ImageFields
	): { image: InlineNode; bytes: string } | null {
		const paragraph = blockNodeAt(getDoc(), target.paragraphPath);
		if (!paragraph) return null;
		const image = findImageInParagraph(paragraph, target.sourceStart, deps.linkRef);
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
		void inlineRange.commitInlineRange(
			target.paragraphPath,
			edit.image.start,
			edit.image.end,
			edit.bytes,
			target.preSelectOffset
		);
	}

	function commitImageResize(newWidth: number, newHeight: number | undefined): void {
		const sel = widgetSelection.getSelected();
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

	/** The whole `![...](...)` span goes. The selection clears first, so the undo entry is told
	 *  the caret the user had before selecting the image rather than reading it. */
	function removeImage(target: WidgetTarget): void {
		const image = imageAt(target);
		if (!image) return;
		widgetSelection.clear();
		void inlineRange.commitInlineRange(
			target.paragraphPath,
			image.start,
			image.end,
			'',
			target.preSelectOffset
		);
	}

	function dismissImagePopover(): void {
		widgetSelection.clear();
	}

	function getEditorContentWidth(): number {
		return getEditorEl()?.clientWidth ?? FALLBACK_CONTENT_WIDTH;
	}

	function attachWidgetSelectListener(): () => void {
		const root = getEditorEl();
		if (!root) return () => {};
		const handler = (e: Event) => widgetSelection.select((e as CustomEvent).detail as WidgetTarget);
		root.addEventListener('image-widget-select', handler);
		return () => root.removeEventListener('image-widget-select', handler);
	}

	function clearStaleSelection(): void {
		const sel = widgetSelection.getSelected();
		if (sel && !imageAt(sel)) widgetSelection.clear();
	}

	function syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void {
		const noop = () => {};
		const overlayEl = getOverlay();
		const editorEl = getEditorEl();
		if (!overlayEl || !editorEl) return noop;

		// Each commit rebuilds the inline DOM, so a captured widget ref would observe a
		// detached node forever: re-resolve on every update and re-attach the observer
		// when widget identity changes.
		let observer: ResizeObserver | null = null;
		let observed: HTMLElement | null = null;

		const update = () => {
			const widgetEl = getSelectedImageFields()?.widgetEl;
			if (!widgetEl) return;
			if (widgetEl !== observed) {
				observer?.disconnect();
				observer = new ResizeObserver(update);
				observer.observe(widgetEl);
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

		// Sibling images settling their dimensions shift the selected widget's y without
		// resizing it, which the ResizeObserver never sees. Capture phase: neither
		// event bubbles.
		const onImgSettle = (e: Event) => {
			if (e.target instanceof HTMLImageElement) update();
		};
		editorEl.addEventListener('load', onImgSettle, true);
		editorEl.addEventListener('error', onImgSettle, true);

		return () => {
			observer?.disconnect();
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

function findImageInParagraph(
	para: NodeView,
	sourceStart: number,
	linkRef: LinkReferenceResolverRef | undefined
): InlineNode | null {
	// Resolver-aware so a reference-style image resolves as the render path saw it,
	// and flattened so an image nested in a link (`[![alt][ref]][repo]`) is found.
	const inlines = resolvedInlineContent(para, linkRef);
	for (const widget of flattenInlineWidgets(inlines, para.raw)) {
		if (widget.kind === 'image' && widget.start === sourceStart) return widget;
	}
	return null;
}
