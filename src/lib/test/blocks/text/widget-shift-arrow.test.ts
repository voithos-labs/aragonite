// @vitest-environment jsdom
//
// Guards widgetExtensionTarget's widget filter: Shift+Arrow extension must target ANY atomic
// inline widget, not only images. A raw-HTML <br> renders as a live widget, so a caret at its edge
// plus Shift+ArrowRight must extend across it. Chromium straddles the contenteditable=false island
// natively (so e2e cannot discriminate); jsdom does not, so this catches a regression to
// `kind !== 'image'`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { getInlineContent } from '$lib/core/inline/inline-cache';
import { buildLiveHtmlWidget } from '$lib/core/inline/raw-html-widget';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import type { CstNode } from '$lib/core/nodes';

describe('handleShiftArrowIntoWidget — non-image inline widget', () => {
	let el: HTMLElement;
	let tA: Text;
	let tB: Text;
	let widget: HTMLElement;
	let node: CstNode;

	beforeEach(() => {
		// `a<br>b` — text "a" [0,1), rawHtml <br> [1,5), text "b" [5,6).
		node = parse('a<br>b\n').children[0];
		const inlines = getInlineContent(node);
		const br = inlines.find((n) => n.kind === 'rawHtml');
		if (!br || br.start !== 1 || br.end !== 5) {
			throw new Error(`expected rawHtml widget at [1,5), got ${JSON.stringify(br)}`);
		}

		el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		tA = document.createTextNode('a');
		widget = buildLiveHtmlWidget(br);
		tB = document.createTextNode('b');
		el.append(tA, widget, tB);
		document.body.appendChild(el);
	});

	afterEach(() => {
		el.remove();
		window.getSelection()?.removeAllRanges();
	});

	function makeInteraction() {
		// Only node / getEl / getAmbientLength / linkRef are read on this path; the rest stay throwing
		// stubs so any accidental coupling introduced later surfaces.
		const trap = () => {
			throw new Error('unexpected dep access on the shift-arrow extension path');
		};
		const deps = {
			get node() {
				return node;
			},
			get index() {
				return 0;
			},
			get myPath() {
				return [0];
			},
			getEl: () => el,
			getAmbientLength: () => 0,
			getEditorContentWidth: trap,
			cursor: new Proxy({}, { get: trap }),
			widgetSelection: new Proxy({}, { get: trap }),
			blockEdit: new Proxy({}, { get: trap }),
			focusActions: new Proxy({}, { get: trap }),
			setSnapTarget: trap,
			setPendingCursor: trap,
			get linkRef() {
				return undefined;
			}
		} as unknown as WidgetInteractionDeps;
		return createWidgetInteraction(deps);
	}

	function placeCaret(node: Node, offset: number): Selection {
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		const range = document.createRange();
		range.setStart(node, offset);
		range.collapse(true);
		sel.addRange(range);
		return sel;
	}

	it('consumes Shift+ArrowRight when the caret sits against a <br> widget edge', () => {
		const interaction = makeInteraction();
		// Caret at text "a" offset 1 == raw offset 1 == the widget's leading edge.
		const sel = placeCaret(tA, 1);
		const evt = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });

		const consumed = interaction.handleShiftArrowIntoWidget(evt);

		// Primary discriminator: reverting the filter to `kind !== 'image'` skips the rawHtml node (no
		// image present), the handler returns false, and this assertion fails.
		expect(consumed).toBe(true);
		// Secondary: the native selection now spans the widget — focus moved to the
		// far (trailing) edge, raw offset 5 == text "b" offset 0.
		expect(sel.isCollapsed).toBe(false);
		expect(sel.focusNode).toBe(tB);
		expect(sel.focusOffset).toBe(0);
	});

	it('does not consume when no widget sits at the caret edge', () => {
		const interaction = makeInteraction();
		// Caret at text "b" offset 1 == raw offset 6 — past the widget, plain text.
		placeCaret(tB, 1);
		const evt = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });

		expect(interaction.handleShiftArrowIntoWidget(evt)).toBe(false);
	});
});
