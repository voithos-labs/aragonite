import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCoreOracles } from '../../simulation/invariants';
import {
	RANGE_INTERRUPT_GESTURES,
	type RangeInterruptGesture
} from '../../simulation/gestures/range-interrupt';

// Deterministic reachability for the select-all → gesture → keystroke family: every
// gesture fires once here over a document shaped to reach it, so coverage never
// depends on which seed drew what. The note sessions add the fuzz dimension — a
// gesture landing mid-session against whatever tree the build produced.
//
// PROBES is keyed by the gesture union, so a gesture joining the family without a
// probe is a `npm run check` error rather than a silent hole; the closing test pins
// the same fact at runtime for a reader who only runs the suite.
//
// See requirements/simulation/range-interrupt-ops.md for each gesture's two
// predictions and the one it is pinned to.

const PROSE_DOC = 'first para\n\nsecond para\n\nthird para\n';
const IMAGE_DOC = 'first para\n\nsecond para\n\n![diagram|440](/test-fixtures/sample.png)\n';
// The table is the LAST block, so the band below the document clamps onto it.
const TABLE_TAIL_DOC = 'lead para\n\nmiddle para\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const MATH_DOC = 'Alpha lead paragraph.\n\nBeta $x^2$ middle.\n\nGamma tail paragraph.\n';
const BLOCK_MATH_DOC = 'Alpha lead paragraph.\n\n$$x^2$$\n\nGamma tail paragraph.\n';
const TOC_DOC = '# Overview\n\nSome prose here.\n\n## Details\n\n[[toc]]\n\nFooter line.\n';

interface Probe {
	/** The plugins route is only for gestures a bundled plugin's surface provides. */
	route: 'editor' | 'plugins';
	title: string;
	doc: string;
	/** The mounted surface the gesture aims at, waited for before the range is built. */
	ready?: string;
}

const PROBES: Record<RangeInterruptGesture, Probe> = {
	'dead-space-below': {
		route: 'editor',
		title: 'a click below the last block lands a caret and ends the range',
		doc: PROSE_DOC
	},
	'dead-space-margin': {
		route: 'editor',
		title: 'a click in the right margin lands a caret and ends the range',
		doc: PROSE_DOC
	},
	'dead-space-below-table': {
		route: 'editor',
		title: 'a click below a table declines and leaves the range to the keystroke',
		doc: TABLE_TAIL_DOC,
		ready: '.table-block'
	},
	'image-click': {
		route: 'editor',
		title: 'an image click replaces only the widget it selected',
		doc: IMAGE_DOC,
		ready: '[data-image-widget]'
	},
	'drag-handle-press': {
		route: 'editor',
		title: 'a reorder-grip press without a drag leaves the range to the keystroke',
		doc: PROSE_DOC
	},
	escape: {
		route: 'editor',
		title: 'Escape collapses the range to its anchor and types there',
		doc: PROSE_DOC
	},
	'search-round-trip': {
		route: 'editor',
		title: 'a find-bar open/navigate/close hands the range back to the keystroke',
		doc: PROSE_DOC
	},
	'inline-reveal-click': {
		route: 'plugins',
		title: 'an inline reveal click types into the reveal, not over the document',
		doc: MATH_DOC,
		ready: '.math-inline-widget'
	},
	// The render-primary reveal click is the gesture whose missing reset cost a
	// whole-document delete — the one door with no source text for the cross-block
	// dispatcher to hit-test, so its rendered view owes the preamble itself.
	'block-reveal-click': {
		route: 'plugins',
		title: 'a render-primary reveal click types into the reveal, not over the document',
		doc: BLOCK_MATH_DOC,
		ready: '.math-block-render'
	},
	// A TOC entry lands its caret through `rects.navigateTo`, not through any pointer
	// door — outside the perimeter G2.12 can see at all.
	'toc-entry-click': {
		route: 'plugins',
		title: 'a TOC entry click types at the heading it navigated to',
		doc: TOC_DOC,
		ready: '.toc-block-nav'
	}
};

class PluginsSimPage extends EditorPage {
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

function probesFor(route: Probe['route']): [RangeInterruptGesture, Probe][] {
	return (Object.entries(PROBES) as [RangeInterruptGesture, Probe][]).filter(
		([, probe]) => probe.route === route
	);
}

async function runProbe(
	page: Page,
	editor: EditorPage,
	gesture: RangeInterruptGesture,
	probe: Probe
): Promise<void> {
	const errors = attachErrorCollector(page);
	await errors.start();
	await editor.loadContent(probe.doc);
	if (probe.ready) await page.locator(probe.ready).first().waitFor({ state: 'visible' });
	await editor.waitForRenderFlush();

	const tracker = new ExpectationTracker(await editor.bridge.getSource());
	const ctx: SimContext = { page, editor, tracker, errors, label: gesture };
	const g = new Gestures(ctx, makeRng(1));

	await assertCoreOracles(ctx, `${gesture}: loaded`);
	await g.rangeInterrupt(gesture);
	await assertCoreOracles(ctx, `${gesture}: interrupted`);
}

test.describe('range-interrupt simulation', () => {
	test.describe('editor route', () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto();
		});

		for (const [gesture, probe] of probesFor('editor')) {
			test(`${gesture}: ${probe.title}`, async ({ page }) => {
				await runProbe(page, editor, gesture, probe);
			});
		}
	});

	test.describe('plugins route', () => {
		let editor: PluginsSimPage;

		test.beforeEach(async ({ page }) => {
			editor = new PluginsSimPage(page);
			await editor.gotoPlugins();
		});

		for (const [gesture, probe] of probesFor('plugins')) {
			test(`${gesture}: ${probe.title}`, async ({ page }) => {
				await runProbe(page, editor, gesture, probe);
			});
		}
	});

	test('every gesture in the family has a probe', () => {
		expect(Object.keys(PROBES).sort()).toEqual([...RANGE_INTERRUPT_GESTURES].sort());
	});
});
