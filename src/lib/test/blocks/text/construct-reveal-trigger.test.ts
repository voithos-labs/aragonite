// @vitest-environment jsdom
//
// The DOM half of preview-inline's marker reveal: the trigger flips
// md-construct-reveal on the spans the render stamped, folds behind a tick
// (transient cross-block states manufacture false leaves), freezes during a
// cross-block selection, and records reveal open/fold on the interaction trace.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { createTextRender } from '$lib/components/blocks/text/text-render';
import {
	createConstructReveal,
	type ConstructReveal
} from '$lib/components/blocks/text/construct-reveal';
import { CONSTRUCT_REVEAL_CLASS } from '$lib/cursor/widget-offset';
import {
	enableInteractionTrace,
	disableInteractionTrace,
	resetInteractionTrace,
	interactionTraceSnapshot
} from '$lib/debug/interaction-trace';
import { placeCaretAt } from './math-widget-fixture';
import { makeRenderHarness, type RenderHarness } from './render-fixture';

// 'alpha **bold** tail' — strong spans [6,14); its two `**` spans carry the stamp.
const RAW = 'alpha **bold** tail\n';

describe('createConstructReveal — trigger', () => {
	let el: HTMLElement;
	let node: CstNode;
	let harness: RenderHarness;
	let crossBlock: boolean;
	let reveal: ConstructReveal;

	beforeEach(() => {
		node = parse(RAW).children[0];
		crossBlock = false;
		harness = makeRenderHarness(node, { mode: 'preview-inline' });
		el = harness.el;
		createTextRender(harness.deps).render();
		reveal = createConstructReveal({
			get node() {
				return node;
			},
			get linkRef() {
				return undefined;
			},
			getEl: () => el,
			getAmbientLength: () => 0,
			getPresentationMode: () => harness.deps.presentationMode,
			isCrossBlock: () => crossBlock
		});
	});

	afterEach(() => {
		el.remove();
		window.getSelection()?.removeAllRanges();
		disableInteractionTrace();
		resetInteractionTrace();
	});

	function setCaret(text: string, offset: number): void {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let target: Text | null = null;
		let n: Node | null;
		while ((n = walker.nextNode())) {
			if (n.textContent === text) {
				target = n as Text;
				break;
			}
		}
		if (!target) throw new Error(`setCaret: text node "${text}" not found`);
		placeCaretAt(target, offset);
	}

	const revealedSpans = () => el.querySelectorAll(`.${CONSTRUCT_REVEAL_CLASS}`);

	it('caret in plain text reveals nothing; entering the construct reveals both markers', () => {
		setCaret('alpha ', 2);
		reveal.update();
		expect(revealedSpans().length).toBe(0);

		setCaret('bold', 2);
		reveal.update();
		const spans = revealedSpans();
		expect(spans.length).toBe(2);
		for (const span of spans) {
			expect(span.getAttribute('data-construct-start')).toBe('6');
			expect(span.getAttribute('data-construct-end')).toBe('14');
		}
	});

	it('leaving the construct folds only after the recheck tick survives', async () => {
		setCaret('bold', 2);
		reveal.update();
		expect(revealedSpans().length).toBe(2);

		setCaret('alpha ', 1);
		reveal.update();
		// Not yet — a transient escape must not fold (the cross-block entry race).
		expect(revealedSpans().length).toBe(2);
		await tick();
		await tick();
		expect(revealedSpans().length).toBe(0);
	});

	it('a cross-block selection freezes the reveal state wholesale', async () => {
		setCaret('bold', 2);
		reveal.update();
		crossBlock = true;
		setCaret('alpha ', 1);
		reveal.update();
		await tick();
		await tick();
		expect(revealedSpans().length).toBe(2);

		crossBlock = false;
		reveal.update();
		await tick();
		await tick();
		expect(revealedSpans().length).toBe(0);
	});

	it('force re-applies onto fresh spans without waiting a tick', () => {
		setCaret('bold', 2);
		reveal.update();
		// A rebuild mints unrevealed spans while the chain key is unchanged.
		for (const span of revealedSpans()) span.classList.remove(CONSTRUCT_REVEAL_CLASS);
		reveal.update();
		expect(revealedSpans().length).toBe(0); // key-equal: the cheap path skips
		reveal.update(true);
		expect(revealedSpans().length).toBe(2);
	});

	it('force-clearing applies immediately when the mode leaves preview-inline', () => {
		setCaret('bold', 2);
		reveal.update();
		expect(revealedSpans().length).toBe(2);
		harness.setMode('source');
		reveal.update(true);
		expect(revealedSpans().length).toBe(0);
	});

	it('prepareStep reveals the chain one step ahead, before any selectionchange', () => {
		// The keydown backstop: rapid input outruns the selectionchange task, so the
		// step's target chain must be revealed synchronously in keydown.
		setCaret('alpha ', 5); // raw 5 — one step left of the construct's inclusive start
		reveal.prepareStep(1);
		expect(revealedSpans().length).toBe(2);
	});

	it('prepareStep(0) applies the caret chain synchronously for destructive keys', () => {
		setCaret(' tail', 0); // raw 14 — the trailing edge; Backspace eats a marker byte
		reveal.prepareStep(0);
		expect(revealedSpans().length).toBe(2);
	});

	it('prepareForKeydown maps plain keys and ignores modifier chords', () => {
		setCaret('alpha ', 5);
		reveal.prepareForKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
		expect(revealedSpans().length).toBe(0);
		reveal.prepareForKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
		expect(revealedSpans().length).toBe(2);
	});

	it('prepareStep never folds — an empty union leaves the applied chain alone', () => {
		setCaret('bold', 2);
		reveal.update();
		expect(revealedSpans().length).toBe(2);
		setCaret(' tail', 2); // raw 16 — outside; the fold belongs to selection cadence
		reveal.prepareStep(1);
		expect(revealedSpans().length).toBe(2);
	});

	it('records reveal open and caret-exit fold on the interaction trace', async () => {
		enableInteractionTrace();
		setCaret('bold', 2);
		reveal.update();
		setCaret('alpha ', 1);
		reveal.update();
		await tick();
		await tick();

		const entries = interactionTraceSnapshot().filter((e) => e.site === 'reveal');
		expect(entries).toEqual([
			expect.objectContaining({
				kind: 'open',
				detail: { tier: 'construct', construct: 'strong:6-14' }
			}),
			expect.objectContaining({
				kind: 'fold',
				detail: { reason: 'caret-exit', construct: 'strong:6-14' }
			})
		]);
	});
});
