import { parseInline, getContentRange, isProseKind } from '../../core/inline';
import type { CstNode, Document, InlineNode } from '../../core/nodes';
import { rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import { buildImageSourceBytes, type ImageFields } from './image-source-bytes';
import type { WidgetSelectionState } from './widget-selection-state.svelte';

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
	commitImageEdit(newFields: ImageFields): void;
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

	function commitImageEdit(newFields: ImageFields): void {
		const sel = widgetSelection.getSelected();
		if (!sel) return;
		const ctx = getSelectedImageFields();
		if (!ctx) return;
		const newSourceBytes = buildImageSourceBytes(newFields);
		const oldStart = ctx.image.start;
		const oldEnd = ctx.image.end;
		const newRaw =
			ctx.paragraph.raw.slice(0, oldStart) + newSourceBytes + ctx.paragraph.raw.slice(oldEnd);
		void commitParagraphRaw(sel.paragraphPath, newRaw);
		widgetSelection.clear();
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
		commitImageEdit(newFields);
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
		const handler = (e: Event) =>
			widgetSelection.select(
				(e as CustomEvent).detail as { paragraphPath: number[]; sourceStart: number }
			);
		root.addEventListener('image-widget-select', handler);
		return () => root.removeEventListener('image-widget-select', handler);
	}

	function syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void {
		const noop = () => {};
		const overlayEl = getOverlay();
		const editorEl = getEditorEl();
		if (!overlayEl || !editorEl) return noop;
		const ctx = getSelectedImageFields();
		if (!ctx?.widgetEl) return noop;
		const widgetEl = ctx.widgetEl;

		const update = () => {
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

		const observer = new ResizeObserver(update);
		observer.observe(widgetEl);

		// Edits above the widget shift its y without resizing it.
		const unsubscribeEdit = events.on('edit', update);
		window.addEventListener('resize', update);

		return () => {
			observer.disconnect();
			unsubscribeEdit();
			window.removeEventListener('resize', update);
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
