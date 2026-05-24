import { parseInline, getContentRange, isProseKind } from '../../core/inline';
import type { CstNode, Document, InlineNode } from '../../core/nodes';
import { rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import { buildImageSourceBytes, type ImageFields } from './image-source-bytes';
import type { WidgetSelectionState, WidgetTarget } from './widget-selection-state.svelte';

// ── Public API ──────────────────────────────────────────────────────────

export interface ImageEditCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
	events: EditorEvents;
}

export interface SelectedImageFields {
	paragraph: CstNode;
	image: InlineNode;
	widgetEl: HTMLElement | null;
	parent: { children?: CstNode[] };
}

export interface ImageEditCommitter {
	getSelectedImageFields(): SelectedImageFields | null;
	/**
	 * `target` is captured at popover-mount time, not derived from the live
	 * widgetSelection — popover commits (URL/alt/title edits, on-unmount-on-switch)
	 * may fire after the user has clicked a different widget, and writing to the
	 * new selection would cross-pollinate the two images.
	 */
	commitImageEdit(target: WidgetTarget, newFields: ImageFields): void;
	commitImageResize(newWidth: number, newHeight: number | undefined): void;
	dismissImagePopover(): void;
	getEditorContentWidth(): number;
	attachWidgetSelectListener(): () => void;
	syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void;
}

export function createImageEditCommitter(deps: ImageEditCommitterDeps): ImageEditCommitter {
	const { getDoc, getEditorEl, widgetSelection, controller, events } = deps;

	function resolvePathToParagraph(path: number[]): {
		paragraph: CstNode;
		parent: { children?: CstNode[] };
	} | null {
		if (path.length === 0) return null;
		let parent: { children?: CstNode[] } = getDoc();
		for (let i = 0; i < path.length - 1; i++) {
			const next = parent.children?.[path[i]];
			if (!next) return null;
			parent = next;
		}
		const paragraph = parent.children?.[path[path.length - 1]];
		if (!paragraph) return null;
		return { paragraph, parent };
	}

	function findImageInParagraph(para: CstNode, sourceStart: number): InlineNode | null {
		for (const inline of para.inlineContent ?? []) {
			if (inline.kind === 'image' && inline.start === sourceStart) return inline;
		}
		return null;
	}

	function queryWidgetEl(paragraphPath: number[], sourceStart: number): HTMLElement | null {
		const root = getEditorEl();
		if (!root) return null;
		return root.querySelector(
			`[data-image-widget][data-source-start="${sourceStart}"][data-paragraph-path="${paragraphPath.join(',')}"]`
		) as HTMLElement | null;
	}

	function getSelectedImageFields(): SelectedImageFields | null {
		const sel = widgetSelection.getSelected();
		if (!sel) return null;
		const resolved = resolvePathToParagraph(sel.paragraphPath);
		if (!resolved) return null;
		const image = findImageInParagraph(resolved.paragraph, sel.sourceStart);
		if (!image) return null;
		return {
			paragraph: resolved.paragraph,
			image,
			widgetEl: queryWidgetEl(sel.paragraphPath, sel.sourceStart),
			parent: resolved.parent
		};
	}

	async function commitParagraphRaw(paragraphPath: number[], newRaw: string): Promise<void> {
		const resolved = resolvePathToParagraph(paragraphPath);
		if (!resolved) return;
		const { paragraph } = resolved;
		const snapshot = { blockIndex: paragraphPath[0], offset: 0 };
		const mutate = () => {
			paragraph.raw = newRaw;
			if (isProseKind(paragraph.kind)) {
				const range = getContentRange(paragraph);
				paragraph.inlineContent = parseInline(paragraph.raw, range.start, range.end);
			}
			if (paragraphPath.length > 1) rebuildAncestryRawForLeaf(getDoc(), paragraphPath);
			return { op: 'noop' as const };
		};

		if (paragraphPath.length === 1) {
			await controller.commitStructural({
				snapshot,
				mutate,
				op: { kind: 'updateContent', detail: { length: newRaw.length } }
			});
			return;
		}

		const containerNode = resolved.parent as CstNode;
		await controller.commitContainerStructural({
			containerNode,
			state: expectStateForNode(containerNode),
			snapshot,
			mutate,
			op: { kind: 'updateContent', detail: { length: newRaw.length }, eventPath: paragraphPath }
		});
	}

	function commitImageEdit(target: WidgetTarget, newFields: ImageFields): void {
		const resolved = resolvePathToParagraph(target.paragraphPath);
		if (!resolved) return;
		const image = findImageInParagraph(resolved.paragraph, target.sourceStart);
		if (!image) return;
		const newSourceBytes = buildImageSourceBytes(newFields);
		const newRaw =
			resolved.paragraph.raw.slice(0, image.start) +
			newSourceBytes +
			resolved.paragraph.raw.slice(image.end);
		void commitParagraphRaw(target.paragraphPath, newRaw);
	}

	function commitImageResize(newWidth: number, newHeight: number | undefined): void {
		const sel = widgetSelection.getSelected();
		if (!sel) return;
		const ctx = getSelectedImageFields();
		if (!ctx) return;
		const newFields: ImageFields = {
			alt: ctx.image.alt ?? '',
			url: ctx.image.url ?? '',
			...(ctx.image.title !== undefined ? { title: ctx.image.title } : {}),
			width: newWidth,
			...(newHeight !== undefined ? { height: newHeight } : {})
		};
		commitImageEdit(sel, newFields);
	}

	function dismissImagePopover(): void {
		widgetSelection.clear();
	}

	function getEditorContentWidth(): number {
		return getEditorEl()?.clientWidth ?? 800;
	}

	function attachWidgetSelectListener(): () => void {
		const root = getEditorEl();
		if (!root) return () => {};
		const handler = (e: Event) => widgetSelection.select((e as CustomEvent).detail as WidgetTarget);
		root.addEventListener('image-widget-select', handler);
		return () => root.removeEventListener('image-widget-select', handler);
	}

	function syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void {
		const noop = () => {};
		const overlayEl = getOverlay();
		const editorEl = getEditorEl();
		if (!overlayEl || !editorEl) return noop;

		// Each commit rebuilds the inline DOM via text-render's
		// `replaceChildren`; a captured widget ref would observe a detached
		// node forever. Re-resolve via the live selection on every update and
		// re-attach the ResizeObserver when widget identity changes.
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

		// Edits above the widget shift its y without resizing it; commits to
		// the widget itself rebuild its DOM and require RO re-attach.
		const unsubscribeEdit = events.on('edit', update);
		window.addEventListener('resize', update);

		// Sibling images settling their dimensions (slow URL re-fetches,
		// lazy-load) reflow the editor and shift the selected widget's y
		// without resizing it — RO won't fire on a pure position change. The
		// settling image's load/error event lets us re-anchor the overlay.
		// Both events fire only in capture phase since they don't bubble.
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
		commitImageResize,
		dismissImagePopover,
		getEditorContentWidth,
		attachWidgetSelectListener,
		syncOverlayToWidget
	};
}
