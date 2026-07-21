// Shared scaffolding for the widget-reveal unit suites (reveal-commit,
// reveal-collapse). The stamped wrapper is a faithful stand-in for the render
// layer's portal island: the interaction layer reads only the marker attributes
// and the source text between flanking prose. Mounting the real MathInline
// (Svelte + KaTeX) is the e2e's job.
import { afterEach, beforeEach } from 'vitest';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import type { WidgetInteractionDeps } from '$lib/components/blocks/text/widget-interaction';
import type { CstNode, InlineNode } from '$lib/core/nodes';

export function stampMathWidget(node: InlineNode): HTMLElement {
	const wrapper = document.createElement('span');
	wrapper.dataset.inlineWidget = '';
	wrapper.dataset.sourceStart = String(node.start);
	wrapper.dataset.sourceEnd = String(node.end);
	wrapper.setAttribute('contenteditable', 'false');
	wrapper.textContent = 'x';
	return wrapper;
}

export function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

/** The reset pair the widget-reveal suites share: register the math inline kind
 *  before each test, tear the platform + mounted DOM down after. */
export function installMathInline(): void {
	beforeEach(() => {
		resetInlineState();
		registerMathInline();
	});
	afterEach(() => {
		document.body.innerHTML = '';
		resetInlineState();
	});
}

// ── Widget-block mount + interaction deps ────────────────────────────────────

export interface MountedWidgetBlock {
	el: HTMLDivElement;
	node: CstNode;
	/** Stamped widget elements, document order. */
	widgets: HTMLElement[];
	/** The inline nodes of `kind` the widgets stand in for, document order. */
	inlineWidgets: InlineNode[];
}

// Mounts `source` as a contenteditable block the way TextEditableBlock renders it:
// each atomic widget island of `kind` stamped between the surrounding prose text
// nodes. Zero-length prose is omitted, so a leading- or trailing-edge widget has no
// empty text node beside it — matching the render layer's child structure.
// `kind` is the raw kind string (comparison-only) — callers hold raw literals like
// MATH_INLINE, not the branded AnyInlineKind.
export function mountWidgetBlock(source: string, kind: string): MountedWidgetBlock {
	const node = parse(source).children[0];
	const inlineWidgets = computeInlineContent(node).filter((n) => n.kind === kind);
	const display = trimTrailingLineEnding(node.raw);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	const widgets: HTMLElement[] = [];
	let cursor = 0;
	for (const w of inlineWidgets) {
		if (w.start > cursor) el.append(document.createTextNode(node.raw.slice(cursor, w.start)));
		const stamped = stampMathWidget(w);
		el.append(stamped);
		widgets.push(stamped);
		cursor = w.end;
	}
	const tail = display.slice(cursor);
	if (tail.length > 0) el.append(document.createTextNode(tail));
	document.body.appendChild(el);
	el.focus();
	return { el, node, widgets, inlineWidgets };
}

// Passive-only base for a WidgetInteractionDeps: node/index/path wiring, element
// access, ambient/width zeros, a fresh widget-selection, and DOM-reading readRawText.
// EVERY behaviour a test asserts on — commit recorder, pending-cursor sink, reveal
// mirror, cross-block flag, cursor/focus handles, rect stubs — must be supplied by
// the caller's `overrides` (which win), never defaulted here: a baked behaviour
// default would let a test assert against this stub instead of its own spy.
export function widgetInteractionDeps(
	base: { node: CstNode; el: HTMLElement },
	overrides: Record<string, unknown>
): WidgetInteractionDeps {
	return {
		get node() {
			return base.node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => base.el,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => 800,
		widgetSelection: createWidgetSelectionState({ onSelect: () => {} }),
		getSnapTarget: () => null,
		setSnapTarget: () => {},
		readRawText: () =>
			Array.from(base.el.childNodes).reduce(
				(acc, child) => acc + rawTextOfNode(child, base.node.raw),
				''
			),
		get linkRef() {
			return undefined;
		},
		...overrides
	} as unknown as WidgetInteractionDeps;
}
