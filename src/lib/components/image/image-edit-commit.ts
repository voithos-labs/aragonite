import { getInlineContent } from '../../core/inline/inline-cache';
import { flattenInlineWidgets } from '../../core/inline/inline-widgets';
import type { CstNode, Document, InlineNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { isBlockNode } from '../../tree-operations/node-ops';
import type { LinkReferenceResolverRef } from '../../editor-keys';
import { ensureUnsharedChild, ensureUnsharedPath } from '../../tree-operations/unshare';
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
		// Resolver-aware so a reference-style image resolves the same way the render
		// path saw it — otherwise the widget the user clicked has no match here.
		// Flattened so an image nested in a link (`[![alt][ref]][repo]`) is found.
		const inlines = getInlineContent(para, deps.linkRef?.current, deps.linkRef?.signature ?? '');
		for (const widget of flattenInlineWidgets(inlines, para.raw)) {
			if (widget.kind === 'image' && widget.start === sourceStart) return widget;
		}
		return null;
	}

	function queryWidgetEl(paragraphPath: number[], sourceStart: number): HTMLElement | null {
		const root = getEditorEl();
		if (!root) return null;
		// Locate the widget by its live block-host path (kept in sync) rather than
		// a baked path attribute on the widget — see widget-dom.ts's pointerdown.
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
		// Nothing to persist — skip the commit so a no-op edit (e.g. a popover
		// dismiss after a resize already wrote the change) adds no undo entry.
		if (newRaw === resolved.paragraph.raw) return;
		const snapshot = { path: paragraphPath.slice(), offset: 0 };
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
					eventPath: paragraphPath.slice()
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
			op: { kind: 'updateContent', detail: { length: newRaw.length }, eventPath: paragraphPath }
		});
	}

	function commitImageEdit(target: WidgetTarget, newFields: ImageFields): void {
		const resolved = resolvePathToParagraph(target.paragraphPath);
		if (!resolved) return;
		const image = findImageInParagraph(resolved.paragraph, target.sourceStart);
		if (!image) return;
		// Preserve the reference form on a resize/dimension/alt edit: the url and
		// title live in the LRD, so leaving them untouched means re-emit `[label]`
		// rather than inlining the resolved url (which would orphan the LRD).
		// An explicit url/title change is the user opting into the inline form.
		const fields: ImageFields =
			image.label !== undefined && newFields.url === image.url && newFields.title === image.title
				? { ...newFields, label: image.label }
				: newFields;
		const newSourceBytes = buildImageSourceBytes(fields);
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
