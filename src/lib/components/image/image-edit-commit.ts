import { getInlineContent } from '../../core/inline/inline-cache';
import { flattenInlineWidgets } from '../../core/inline/inline-widgets';
import type { CstNode, Document, ImageFields, InlineNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { isBlockNode } from '../../tree-operations/node-ops';
import type { LinkReferenceResolverRef } from '../../editor-keys';
import { ensureUnsharedChild, ensureUnsharedPath } from '../../tree-operations/unshare';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { UndoController } from '../../editor-actions/deps';
import type { EditorEvents } from '../../editor-events';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { FALLBACK_CONTENT_WIDTH } from '../../cursor/typography-estimates';
import { buildImageEditBytes } from './image-source-bytes';
import type { WidgetSelectionState, WidgetTarget } from './widget-selection-state.svelte';

// ── Public API ──────────────────────────────────────────────────────────

export interface ImageEditCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
	events: EditorEvents;
	linkRef?: LinkReferenceResolverRef;
}

export interface SelectedImageFields {
	paragraph: NodeView;
	image: InlineNode;
	widgetEl: HTMLElement | null;
	parent: DocumentView | NodeView;
}

export interface ImageEditCommitter {
	getSelectedImageFields(): SelectedImageFields | null;
	/**
	 * `target` is captured at popover-mount time, not read from the live
	 * widgetSelection: a popover commit can fire after the user clicked a different
	 * widget, and writing to the new selection cross-pollinates the two images.
	 */
	commitImageEdit(target: WidgetTarget, newFields: ImageFields): void;
	/** The bytes `commitImageEdit` would write, or `null` if it would decline — the
	 *  popover's dirty check compares against these. */
	buildEditBytes(target: WidgetTarget, newFields: ImageFields): string | null;
	commitImageResize(newWidth: number, newHeight: number | undefined): void;
	dismissImagePopover(): void;
	getEditorContentWidth(): number;
	attachWidgetSelectListener(): () => void;
	syncOverlayToWidget(getOverlay: () => HTMLElement | null): () => void;
}

export function createImageEditCommitter(deps: ImageEditCommitterDeps): ImageEditCommitter {
	const { getDoc, getEditorEl, widgetSelection, controller, events } = deps;

	function resolvePathToParagraph(path: number[]): {
		paragraph: NodeView;
		parent: DocumentView | NodeView;
	} | null {
		if (path.length === 0) return null;
		let parent: DocumentView | NodeView = getDoc();
		for (let i = 0; i < path.length - 1; i++) {
			// Annotated: the `parent` reassignment otherwise cycles inference.
			const next: NodeView | undefined = parent.children?.[path[i]];
			if (!next) return null;
			parent = next;
		}
		const paragraph = parent.children?.[path[path.length - 1]];
		if (!paragraph) return null;
		return { paragraph, parent };
	}

	function findImageInParagraph(para: NodeView, sourceStart: number): InlineNode | null {
		// Resolver-aware so a reference-style image resolves as the render path saw it,
		// and flattened so an image nested in a link (`[![alt][ref]][repo]`) is found.
		const inlines = getInlineContent(para, deps.linkRef?.current, deps.linkRef?.signature ?? '');
		for (const widget of flattenInlineWidgets(inlines, para.raw)) {
			if (widget.kind === 'image' && widget.start === sourceStart) return widget;
		}
		return null;
	}

	function queryWidgetEl(paragraphPath: number[], sourceStart: number): HTMLElement | null {
		const root = getEditorEl();
		if (!root) return null;
		// Locate by the live block-host path, never a baked attribute on the widget —
		// see widget-dom.ts's click handler.
		const host = root.querySelector(`[data-block-path='${JSON.stringify(paragraphPath)}']`);
		if (!host) return null;
		return host.querySelector(
			`[data-image-widget][data-source-start="${sourceStart}"]`
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
		// Skip the commit so a no-op edit (a popover dismiss after a resize already
		// wrote the change) adds no undo entry.
		if (newRaw === resolved.paragraph.raw) return;
		const snapshot = { path: docPathFrom(paragraphPath), offset: 0 };
		const leafIdx = paragraphPath[paragraphPath.length - 1];
		const writeRaw = (paragraph: CstNode) => {
			paragraph.raw = newRaw;
		};

		if (paragraphPath.length === 1) {
			await controller.commitStructural({
				snapshot,
				mutate: (children) => {
					const [owned] = ensureUnsharedPath({ children }, [leafIdx], controller.sharing);
					writeRaw(owned);
					return { op: 'noop' as const };
				},
				op: {
					kind: 'updateContent',
					detail: { length: newRaw.length },
					eventPath: docPathFrom(paragraphPath)
				}
			});
			return;
		}

		const containerNode = resolved.parent;
		// paragraphPath.length > 1, so the parent is a container node, never the root.
		if (!isBlockNode(containerNode)) return;
		await controller.commitContainerStructural({
			containerNode,
			path: paragraphPath.slice(0, -1),
			state: expectStateForNode(containerNode),
			snapshot,
			mutate: (scope) => {
				writeRaw(ensureUnsharedChild(scope.node, leafIdx, scope.sharing));
				return { op: 'noop' as const };
			},
			op: {
				kind: 'updateContent',
				detail: { length: newRaw.length },
				eventPath: docPathFrom(paragraphPath)
			}
		});
	}

	function resolveEdit(
		target: WidgetTarget,
		newFields: ImageFields
	): { paragraph: NodeView; image: InlineNode; bytes: string } | null {
		const resolved = resolvePathToParagraph(target.paragraphPath);
		if (!resolved) return null;
		const image = findImageInParagraph(resolved.paragraph, target.sourceStart);
		if (!image) return null;
		// Preserve the reference form when url/title are untouched: inlining the
		// resolved url would orphan the LRD. Changing either is the user opting in.
		const fields: ImageFields =
			image.label !== undefined && newFields.url === image.url && newFields.title === image.title
				? { ...newFields, label: image.label }
				: newFields;
		const bytes = buildImageEditBytes(image, resolved.paragraph.raw, fields);
		return bytes === null ? null : { paragraph: resolved.paragraph, image, bytes };
	}

	function buildEditBytes(target: WidgetTarget, newFields: ImageFields): string | null {
		return resolveEdit(target, newFields)?.bytes ?? null;
	}

	function commitImageEdit(target: WidgetTarget, newFields: ImageFields): void {
		const edit = resolveEdit(target, newFields);
		if (!edit) return;
		const newRaw =
			edit.paragraph.raw.slice(0, edit.image.start) +
			edit.bytes +
			edit.paragraph.raw.slice(edit.image.end);
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
		return getEditorEl()?.clientWidth ?? FALLBACK_CONTENT_WIDTH;
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
		dismissImagePopover,
		getEditorContentWidth,
		attachWidgetSelectListener,
		syncOverlayToWidget
	};
}
