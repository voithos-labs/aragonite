// @vitest-environment jsdom
// Miss-analysis: each route that throws measured heights away had its own test or none (the width
// and font-size watchers had none mounted), so nothing asked all four the same question.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors,
	typeInFirstBlock,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import type { HeightOracle } from '$lib/cursor/height-oracle';
import type { Document } from '$lib/core/nodes';
import { ESTIMATE_BASE_FONT_SIZE } from '$lib/cursor/typography-estimates';
import { settleEditor } from '$lib/test/harness/settle';

interface Seam {
	getHeightOracle(): HeightOracle;
	getWidthVersion(): number;
	getContentVersion(): number;
	getDocument(): Document;
}

// ── Geometry set by hand: jsdom lays nothing out, and resizes fire when a row says so ─────────

let width = 800;
let height = 600;
let fontSize = ESTIMATE_BASE_FONT_SIZE;
// Pairs, not a map: in self mode the width and viewport-height watchers observe the same root.
let observed: { el: Element; callback: ResizeObserverCallback }[] = [];

class ManualResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(el: Element): void {
		observed.push({ el, callback: this.callback });
	}
	unobserve(el: Element): void {
		observed = observed.filter((o) => o.el !== el || o.callback !== this.callback);
	}
	disconnect(): void {
		observed = observed.filter((o) => o.callback !== this.callback);
	}
}

const boxHeight = (el: Element) => (el.classList.contains('type-scale-probe') ? fontSize : height);

/** Every watched box reports at once, as a browser's resize delivery does. */
function deliverResize(): void {
	for (const { el, callback } of [...observed]) {
		const entry = { target: el, borderBoxSize: [{ blockSize: boxHeight(el), inlineSize: width }] };
		callback([entry as unknown as ResizeObserverEntry], {} as ResizeObserver);
	}
}

beforeAll(installLayoutStubs);
beforeEach(() => {
	width = 800;
	height = 600;
	fontSize = ESTIMATE_BASE_FONT_SIZE;
	vi.stubGlobal('ResizeObserver', ManualResizeObserver);
	vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
	vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height);
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		return new DOMRect(0, 0, width, boxHeight(this));
	});
});
afterEach(async () => {
	await destroyMountedEditors();
	observed = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ── The routes ──────────────────────────────────────────────────────────────

const OLD_VIEW_ID = 'old-view-block';

/** Mounts in source mode, then records a height as a mounted block's measure pass would. */
function mountWithMeasuredHeight(): MountedEditor<Seam> & { oracle: HeightOracle } {
	const mounted = mountEditor<Seam>({ source: 'one\n\ntwo\n', presentationMode: 'source' });
	const oracle = mounted.instance.__test.getHeightOracle();
	oracle.recordMeasured(OLD_VIEW_ID, 99);
	return { ...mounted, oracle };
}

interface Route {
	name: string;
	/** A width or type-scale change re-wraps every block, so every list's table re-estimates. */
	geometry: boolean;
	run(mounted: MountedEditor<Seam>): Promise<void> | void;
}

const ROUTES: Route[] = [
	{
		name: 'the `source` prop replaces the document',
		geometry: false,
		run: ({ props }) => void (props.source = 'only\n')
	},
	// Reading mode changes the most of any mode: every marker stops painting at once.
	{
		name: 'the presentation mode flips',
		geometry: false,
		run: ({ props }) => void (props.presentationMode = 'reading')
	},
	{
		name: 'the editor narrows',
		geometry: true,
		run: () => {
			width = 500;
			deliverResize();
		}
	},
	{
		name: 'the host’s font size grows',
		geometry: true,
		run: () => {
			fontSize = ESTIMATE_BASE_FONT_SIZE * 1.5;
			deliverResize();
		}
	}
];

describe('every route that changes the view throws the measured heights away', () => {
	for (const route of ROUTES) {
		it(`${route.name}: the measured heights go, and the width version ${
			route.geometry ? 'moves' : 'stays'
		}`, async () => {
			const mounted = mountWithMeasuredHeight();
			const before = mounted.instance.__test.getWidthVersion();

			await route.run(mounted);
			await settleEditor();

			expect(mounted.oracle.measured(OLD_VIEW_ID)).toBeUndefined();
			// A mode switch that bumped it would rebuild with no block held, losing the reader's place.
			expect(mounted.instance.__test.getWidthVersion() !== before).toBe(route.geometry);
		});
	}

	it('a type-scale change scales the estimates it rebuilds with', async () => {
		const mounted = mountWithMeasuredHeight();
		const paragraph = mounted.instance.__test.getDocument().children[0];
		const before = mounted.oracle.estimate(paragraph, 500);

		fontSize = ESTIMATE_BASE_FONT_SIZE * 2;
		deliverResize();
		await settleEditor();

		expect(mounted.oracle.estimate(paragraph, 500)).toBeGreaterThan(before);
	});
});

// ── What keeps them ─────────────────────────────────────────────────────────

describe('a change that keeps the view keeps its measured heights', () => {
	// Ids survive a keystroke, so dropping heights then would cost a full re-measure per batch of typing.
	it('an edit, which replaces no document', async () => {
		const { instance: editor, oracle, target } = mountWithMeasuredHeight();
		const before = editor.__test.getContentVersion();

		typeInFirstBlock(target, 'one!');
		await tick();

		// The version tells the two apart: an input the editor ignored would keep the height too.
		expect(editor.__test.getContentVersion()).not.toBe(before);
		expect(oracle.measured(OLD_VIEW_ID)).toBe(99);
	});

	it('the prop rewritten with the mode already in force', async () => {
		const { oracle, props } = mountWithMeasuredHeight();

		props.presentationMode = 'source';
		await settleEditor();

		expect(oracle.measured(OLD_VIEW_ID)).toBe(99);
	});

	it('a height-only resize, which re-wraps nothing', async () => {
		const { instance: editor, oracle } = mountWithMeasuredHeight();
		const before = editor.__test.getWidthVersion();

		height = 300;
		deliverResize();
		await settleEditor();

		expect(oracle.measured(OLD_VIEW_ID)).toBe(99);
		expect(editor.__test.getWidthVersion()).toBe(before);
	});
});
