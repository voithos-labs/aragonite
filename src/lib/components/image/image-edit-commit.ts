// The popover mounts at editor root, outside any container's Svelte context,
// so it can't reach a nested container's `blockEdit` — this routes through
// the controller's commit primitives directly.

import { parseInline, getContentRange, isProseKind } from '../../core/inline';
import type { CstNode, Document, InlineNode } from '../../core/nodes';
import { rebuildAncestryRawForLeaf } from '../../schema/container-raw';
import { expectStateForNode } from '../../reactivity/state-registry';
import type { UndoController } from '../../editor-actions/deps';
import { buildImageSourceBytes, type ImageFields } from './image-source-bytes';
import type { WidgetSelectionState } from './widget-selection-state.svelte';

// ── Public API ──────────────────────────────────────────────────────────

export interface ImageEditCommitterDeps {
	getDoc: () => Document;
	getEditorEl: () => HTMLElement | null;
	widgetSelection: WidgetSelectionState;
	controller: UndoController;
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
	applySelectedClass(): void;
	reparentResizeHandles(getContainer: () => HTMLElement | null): () => void;
	reparentImageProperties(getContainer: () => HTMLElement | null): () => void;
}

export function createImageEditCommitter(deps: ImageEditCommitterDeps): ImageEditCommitter {
	const { getDoc, getEditorEl, widgetSelection, controller } = deps;

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

	function applySelectedClass(): void {
		const sel = widgetSelection.getSelected();
		const root = getEditorEl();
		if (!root) return;
		root.querySelectorAll('.md-image-widget.md-image-selected').forEach((el) => {
			el.classList.remove('md-image-selected');
		});
		if (sel) {
			const widgetEl = queryWidgetEl(sel.paragraphPath, sel.sourceStart);
			widgetEl?.classList.add('md-image-selected');
		}
	}

	// Reparents children of `portal` into the selected widget so absolute
	// positioning (right/top/bottom on handles, top:100% on the popover)
	// resolves against the widget's box. Returns a cleanup that restores
	// children to the portal so the next selection's effect run can re-move.
	function reparentInto(getContainer: () => HTMLElement | null): () => void {
		const noop = () => {};
		const portal = getContainer();
		if (!portal) return noop;
		const ctx = getSelectedImageFields();
		if (!ctx?.widgetEl) return noop;
		const moved: Node[] = [];
		while (portal.firstChild) {
			const child = portal.firstChild;
			ctx.widgetEl.appendChild(child);
			moved.push(child);
		}
		return () => {
			for (const child of moved) portal.appendChild(child);
		};
	}

	return {
		getSelectedImageFields,
		commitImageEdit,
		commitImageResize,
		dismissImagePopover,
		getEditorContentWidth,
		attachWidgetSelectListener,
		applySelectedClass,
		reparentResizeHandles: reparentInto,
		reparentImageProperties: reparentInto
	};
}
