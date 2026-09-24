// Shared scaffolding for the inline-widget unit suites. The wrapper with the marker attributes
// stands in faithfully for the render's own widget element: the interaction code reads only those
// attributes and the source text between the surrounding prose. Mounting the real MathInline
// (Svelte plus KaTeX) is the e2e's job.
import { defaultGrammarView } from '$lib/schema/block-openers';
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

/** Collapse the selection to a caret at (node, offset). */
export function placeCaretAt(node: Node, offset: number): Selection {
	const range = document.createRange();
	range.setStart(node, offset);
	range.collapse(true);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
	return sel;
}

// ── Widget-block mount + interaction deps ────────────────────────────────────

export interface MountedWidgetBlock {
	el: HTMLDivElement;
	node: CstNode;
	/** Widget elements, in document order. */
	widgets: HTMLElement[];
	/** The inline nodes of `kind` the widgets stand in for, document order. */
	inlineWidgets: InlineNode[];
}

// Mounts `source` the way TextEditableBlock renders it: each atomic widget of `kind` placed
// between the surrounding prose, with zero-length prose left out. `kind` is the raw string.
export function mountWidgetBlock(source: string, kind: string): MountedWidgetBlock {
	const node = parse(source).children[0];
	const inlineWidgets = computeInlineContent(node, undefined, defaultGrammarView).filter(
		(n) => n.kind === kind
	);
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

// A base `WidgetInteractionDeps` that does nothing. Every behaviour a test asserts on has to come
// from the caller's `overrides`, or a test could end up asserting against this stub.
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
