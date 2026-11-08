<!--
  A block a plugin draws: the editor makes the block's text element (`ctx.source`) or, for a block
  focused whole, its focus and keys, calls the plugin's `draw`, and keeps the drawing told through
  `update`. A throw in `draw` or `update` reaches BlockHost's error boundary.
-->
<script lang="ts">
	import { getAllContexts, getContext, mount, unmount, untrack } from 'svelte';
	import { on } from 'svelte/events';
	import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import { blockOf } from '../../schema/doc-view';
	import { blockRangeOf } from '../../editor-actions/commit/change-record';
	import { pluginOfKind } from '../../schema/plugin-name';
	import {
		CARET_AT,
		type BoxDrawContext,
		type ContainerDrawContext,
		type Drawing,
		type Drawn,
		type TextDrawContext
	} from '../../schema/drawing';
	import { getContentRange } from '../../core/inline';
	import { caretOffsetAtPoint } from '../../browser/point';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices
	} from '../../editor-keys';
	import { VIEW_TEXT_ATTR, VIEW_TEXT_HOST_ATTR } from '../../caret/block-content-selector';
	import { editorXOf } from '../../caret/sticky-measure';
	import { checkDomViewContent } from '../../invariants/dom-view-content';
	import { warnIfForeignRuntime } from '../../foreign-runtime';
	import { createEditableLeaf } from '../blocks/editable/editable-leaf';
	import { bindLeafSurface } from '../dom-block-view/leaf-surface-binding.svelte';
	import { createDrawnBox } from './drawn-box.svelte';
	import { createContainerBlock } from '../../editor-actions/plugin/container';
	import BlockList from '../BlockList.svelte';
	import { createRenderCache } from './render-cache';
	import { POINTER_GESTURE_ATTR } from '../../selection/pointer-gesture';

	let {
		drawing,
		node,
		index,
		myPath
	}: { drawing: Drawing; node: NodeView; index: number; myPath: number[] } = $props();

	// Read once: DrawnBlock keys this component on its drawing.
	const view = untrack(() => drawing);
	const editorDoc = getContext<EditorDoc>(EDITOR_DOC_KEY);
	const policies = getContext<EditorPolicies>(EDITOR_POLICIES_KEY);
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);

	// The editor's own elements, made before `draw` runs so the plugin only places them. A server
	// render draws nothing, so it never reads them.
	const element = () =>
		typeof document === 'undefined'
			? (null as unknown as HTMLElement)
			: document.createElement('div');
	const source = element();
	const childBox = view.edit === 'container' ? element() : null;
	source?.setAttribute(VIEW_TEXT_ATTR, '');
	// Its line breaks are text, so they show as breaks: the caret's line moves read them.
	if (source) source.style.whiteSpace = 'pre-wrap';
	let target: HTMLElement | null = $state(null);
	let revealed = $state(false);
	let focusedWithin = $state(false);
	let typed: string | null = $state(null);
	let generation = $state(0);
	let drawn: Drawn<unknown> | null = null;

	const focused = $derived(view.edit === 'source' ? revealed : focusedWithin);
	const leafEl = $derived(
		!target || view.edit === 'box' ? null : view.edit === 'text' || revealed ? source : null
	);

	const leafDeps = {
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => leafEl,
		singleLine: view.singleLine,
		renderSource: view.renderSource,
		onSourceEdit: (text: string) => (typed = text)
	};
	const leaf =
		view.edit === 'source'
			? createEditableLeaf({
					...leafDeps,
					mode: 'render-primary',
					reshapeSource: view.reshapeSource,
					isRevealed: () => revealed,
					setRevealed: (value) => {
						revealed = value;
						// At once, not in an effect: the leaf focuses the text next, and a hidden
						// element takes no focus.
						source.hidden = !value;
						if (!value) typed = null;
					}
				})
			: view.edit === 'text'
				? createEditableLeaf(leafDeps)
				: null;
	if (leaf) {
		bindLeafSurface({
			getEl: () => leafEl,
			props: () => leaf.surfaceProps as unknown as Record<string | symbol, unknown>
		});
	}
	if (leaf && view.edit === 'source') {
		// The whole folded drawing is one click target that opens the text.
		bindLeafSurface({
			getEl: () => (revealed ? null : target),
			props: () => leaf.renderProps as unknown as Record<string | symbol, unknown>
		});
	}

	const box =
		view.edit === 'box'
			? createDrawnBox({
					getNode: () => node,
					getIndex: () => index,
					getPath: () => myPath,
					getTarget: () => target,
					drawn: () => drawn
				})
			: null;

	const container =
		view.edit === 'container'
			? createContainerBlock({
					getNode: () => node,
					getIndex: () => index,
					getPath: () => myPath,
					getBoxEl: () => childBox ?? undefined,
					...(view.ambientPrefix && { getAmbientPrefix: () => view.ambientPrefix!(node) })
				})
			: null;
	// Read after the container factory, which sets the children's windowing context.
	const contexts = getAllContexts();

	export function viewRef(): BlockComponent | undefined {
		return leaf?.blockApi ?? box?.blockApi ?? container?.containerApi;
	}

	// ── The drawing's context ──────────────────────────────────────────────────

	const render = createRenderCache({
		theme: () => policies.theme(),
		bytes: () => node.raw,
		keepScroll: () => keepScroll()
	});

	function keepScroll(): () => Promise<void> {
		return services ? services.scrollOwner.keep() : () => Promise.resolve();
	}

	const ctx: TextDrawContext & BoxDrawContext & ContainerDrawContext = {
		get editor() {
			return editorDoc.scopedEditor(pluginOfKind(node.kind));
		},
		get mode() {
			return editorDoc.reading.mode();
		},
		get theme() {
			return policies.theme();
		},
		get focused() {
			return focused;
		},
		source,
		get typed() {
			return typed;
		},
		render,
		keepScroll,
		children: childBox!,
		title: null,
		leave(edge, x) {
			if (!box || !target) return;
			box.leave(edge, x === undefined ? null : editorXOf(target, x));
		}
	};

	const read = () =>
		blockOf(
			node,
			(kind) => (kind === node.kind ? view.type() : { name: kind, label: kind }),
			(at) => blockRangeOf(editorDoc.doc(), at)
		);

	// ── Mount, update, destroy ────────────────────────────────────────────────

	function report(error: unknown): void {
		warnIfForeignRuntime(error, `block ${node.kind}`);
		services?.events.emit('error', { origin: 'render', error, context: { path: myPath } });
	}

	function mountDrawing(el: HTMLElement): () => void {
		return untrack(() => {
			const text = view.edit === 'text' || view.edit === 'source';
			if (text) el.setAttribute(VIEW_TEXT_HOST_ATTR, '');
			if (view.edit === 'source') source.hidden = !revealed;
			// Mounted before `draw`, so the children are in place wherever the drawing puts them.
			const list =
				container &&
				mount(BlockList, { target: childBox!, props: container.blockListProps, context: contexts });
			const made = view.draw(read(), ctx);
			drawn = made;
			el.append(made.dom);
			target = el;
			const host = el.parentElement as (HTMLElement & { [CARET_AT]?: unknown }) | null;
			if (host && made.caret) host[CARET_AT] = (x: number, y: number) => clickedAt(made, x, y);
			seen = watched();
			if (text) assertInvariant('dom-view-content', () => checkDomViewContent(el, source));
			const offs = [
				...(container ? [on(el, 'keydown', container.handleKeydown)] : []),
				on(el, 'focusin', () => (focusedWithin = true)),
				on(el, 'focusout', (e) => (focusedWithin = el.contains(e.relatedTarget as Node))),
				...['pointerdown', 'mousedown'].map((type) =>
					on(el, type, (e) => keepPress(made, e), { capture: true })
				)
			];
			return () => {
				offs.forEach((off) => off());
				drawn = null;
				target = null;
				if (list) void unmount(list);
				made.dom.remove();
				try {
					made.destroy?.();
				} catch (error) {
					report(error);
				}
			};
		});
	}

	// A click on the drawing's picture of the text lands at that offset of the text.
	function clickedAt(made: Drawn<unknown>, x: number, y: number): number | null {
		const caret = made.caret!;
		const at = typeof caret === 'function' ? caret({ x, y }) : caretOffsetAtPoint(caret, x, y);
		return at === null ? null : getContentRange(node).start + at;
	}

	// A press the drawing keeps reads as its own gesture to the editor's handlers, which run before
	// the document hears it bubble; the mark goes once the document has.
	function keepPress(made: Drawn<unknown>, e: Event): void {
		if (!made.keep?.(e)) return;
		made.dom.setAttribute(POINTER_GESTURE_ATTR, '');
		const unmark = () => made.dom.removeAttribute(POINTER_GESTURE_ATTR);
		document.addEventListener(e.type, unmark, { once: true });
	}

	function watched(): unknown[] {
		return [node.raw, myPath.join(), editorDoc.reading.mode(), policies.theme(), focused, typed];
	}

	let seen: unknown[] = [];
	$effect(() => {
		const now = watched();
		untrack(() => {
			if (!drawn || now.every((value, i) => Object.is(value, seen[i]))) return;
			seen = now;
			const restore = keepScroll();
			if (drawn.update?.(read(), ctx) === false) generation++;
			void restore();
		});
	});
</script>

{#key generation}
	<div {@attach mountDrawing}></div>
{/key}
