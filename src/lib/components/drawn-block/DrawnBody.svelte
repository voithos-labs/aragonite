<!--
  A block a plugin draws: the editor makes the block's text element (`ctx.source`) or, for a block
  focused whole, its focus and keys, calls the plugin's `draw`, and keeps the drawing told through
  `update`. A throw in `draw` or `update` reaches BlockHost's error boundary.
-->
<script module lang="ts">
	import { devWarn } from '@voithos-labs/aragonite/dev-checks';
	import type { AnyBlockKind } from '../../core/nodes';
	import type { EditorServices } from '../../editor-keys';
	import type { Drawing } from '../../schema/drawing';
	import { warnIfForeignRuntime } from '../../foreign-runtime';

	// Outside the component: a block type's watch outlives every drawing that started it.
	function dependsReport(services: EditorServices, kind: AnyBlockKind) {
		return (error: unknown) => {
			warnIfForeignRuntime(error, `block ${kind}`);
			services.events.emit('error', { origin: 'render', error, context: { kind } });
		};
	}

	const unheard = new WeakSet<Drawing>();
	// Once per block type, and only with dev checks on, so the sentence stays out of production.
	function warnUnheard(drawing: Drawing, kind: AnyBlockKind): void {
		if (unheard.has(drawing)) return;
		unheard.add(drawing);
		devWarn(
			'depends-unheard',
			`block type '${kind}' declares depends, but its drawing has no update to hear it`
		);
	}
</script>

<script lang="ts">
	import { getAllContexts, getContext, mount, unmount, untrack } from 'svelte';
	import { on } from 'svelte/events';
	import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import { makeBlock, DETACHED_READING, type KeyWatch } from '../../schema/doc-view';
	import { modeOf } from '../../presentation-mode';
	import { pluginOfKind } from '../../schema/plugin-name';
	import {
		CARET_AT,
		type BoxDrawContext,
		type ContainerDrawContext,
		type Drawn,
		type TextDrawContext
	} from '../../schema/drawing';
	import { getContentRange } from '../../core/inline';
	import { caretOffsetAtPoint, caretPointAt } from '../../browser/point';
	import {
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorPolicies
	} from '../../editor-keys';
	import { VIEW_TEXT_ATTR, VIEW_TEXT_HOST_ATTR } from '../../caret/block-content-selector';
	import { editorXOf } from '../../caret/sticky-measure';
	import { checkDomViewContent } from '../../invariants/dom-view-content';
	import { createSourceLeaf } from '../blocks/editable/editable-leaf';
	import { bindLeafSurface } from './leaf-surface-binding.svelte';
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
	// What `ctx.typed` hands the drawing: the typed text inside the editor's markers.
	let typedText: string | null = null;
	let generation = $state(0);
	let drawn: Drawn<unknown> | null = null;
	// The block type's answers, one watch for all its drawings, so a mount asks nothing it holds.
	let keys: KeyWatch | null = null;
	// The answers' version the drawing last saw.
	let heard = 0;

	// Functions over state, not deriveds: a key handler resuming after the block unmounted still
	// reads them, and a derived read past its effect warns.
	const focused = () => (view.edit === 'source' ? revealed : focusedWithin);
	const leafEl = () =>
		!target || view.edit === 'box' ? null : view.edit === 'text' || revealed ? source : null;

	const leafDeps = {
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: leafEl,
		singleLine: view.singleLine,
		renderSource: view.renderSource,
		onSourceEdit: (text: string) => {
			typedText = view.textOf ? view.textOf(text) : text;
			typed = text;
		}
	};
	const kindPaints = view.paintsText ?? view.renderSource !== undefined;
	const leaf =
		view.edit === 'source'
			? createSourceLeaf(
					{
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
					},
					kindPaints
				)
			: view.edit === 'text'
				? createSourceLeaf(leafDeps, kindPaints)
				: null;
	if (leaf) {
		bindLeafSurface({
			getEl: leafEl,
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
		// The bytes as typed while the source is open, so a live preview through it follows the keys.
		bytes: () => typed ?? node.raw,
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
			return modeOf(editorDoc.reading.mode());
		},
		get theme() {
			return policies.theme();
		},
		get focused() {
			return focused();
		},
		get depends() {
			return keys?.keys() ?? NO_ANSWERS;
		},
		source,
		get typed() {
			return typed === null ? null : typedText;
		},
		render,
		keepScroll,
		children: childBox!,
		title: null,
		leave(edge, x) {
			if (!box || !target) return;
			box.leave(edge, x === undefined ? null : editorXOf(target, x));
		},
		focusWhole: () => box?.focusWhole()
	};

	const read = () =>
		services ? services.read.blockOf(node, myPath) : makeBlock(node, DETACHED_READING, null);
	const NO_ANSWERS: readonly string[] = Object.freeze([]);

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
			if (view.depends && services) {
				keys ??= services.read.keys(view.depends, dependsReport(services, node.kind));
				heard = keys.version();
			}
			// A redraw finds the text the editor painted already in place, which is no drawing's.
			const painted = devChecksOn && text ? [...source.children] : [];
			const made = view.draw(read(), ctx);
			if (devChecksOn && keys && !made.update) warnUnheard(view, node.kind);
			drawn = made;
			el.append(made.dom);
			target = el;
			const host = el.parentElement as (HTMLElement & { [CARET_AT]?: unknown }) | null;
			if (host) host[CARET_AT] = (x: number, y: number) => clickedAt(made, x, y);
			seen = watched();
			if (text) assertInvariant('dom-view-content', () => checkDomViewContent(el, source, painted));
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

	// A click on the drawing's picture of the text lands at that offset of the text. Read per click:
	// a framework component declares its `caret` once it has rendered.
	function clickedAt(made: Drawn<unknown>, x: number, y: number): number | null {
		const caret = made.caret;
		if (!caret) return null;
		// An element with no text to measure (an empty caption) lands at the text's start.
		const at =
			typeof caret === 'function'
				? caret(caretPointAt(x, y))
				: (caretOffsetAtPoint(caret, x, y) ?? 0);
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
		return [node.raw, myPath.join(), editorDoc.reading.mode(), policies.theme(), focused(), typed];
	}

	let seen: unknown[] = [];
	$effect(() => {
		const now = watched();
		// Every write, for a drawing with `depends`: its answers say whether `update` runs.
		if (view.depends) editorDoc.contentVersion();
		untrack(() => {
			const answered = keys?.version() ?? 0;
			if (!drawn || (answered === heard && now.every((value, i) => Object.is(value, seen[i]))))
				return;
			seen = now;
			heard = answered;
			const restore = keepScroll();
			if (drawn.update?.(read(), ctx) === false) generation++;
			void restore();
		});
	});
</script>

{#key generation}
	<div {@attach mountDrawing}></div>
{/key}
