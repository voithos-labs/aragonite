import type { Page } from '@playwright/test';
import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import type { RangeInterruptGesture } from '../../simulation/gestures/range-interrupt';
import { makeSimContext } from './helpers';

// Every select-all, gesture, keystroke sequence, run once over a document shaped to reach it,
// so coverage never depends on which seed drew what. PROBES is keyed by the list of gestures
// itself, so a new gesture without a probe fails `npm run check` rather than leaving a silent
// hole. What each gesture is expected to do:
// requirements/simulation/range-interrupt-ops.md.

const PROSE_DOC = 'first para\n\nsecond para\n\nthird para\n';
// Prose carries no drag handle, so the thematic break is the block whose handle can be pressed.
const GRIP_DOC = PROSE_DOC + '\n---\n';
const IMAGE_DOC = 'first para\n\nsecond para\n\n![diagram|440](/test-fixtures/sample.png)\n';
const MATH_DOC = 'Alpha lead paragraph.\n\nBeta $x^2$ middle.\n\nGamma tail paragraph.\n';
const BLOCK_MATH_DOC = 'Alpha lead paragraph.\n\n$$x^2$$\n\nGamma tail paragraph.\n';
// The blank lines keep the fixture tidy rather than working around anything: demoting
// `# Overview` behaves the same either way, so the live document and a reload agree.
const TOC_DOC = '# Overview\n\nSome prose here.\n\n## Details\n\n[[toc]]\n\nFooter line.\n';
// A table first, so the editor's top padding is a gap a click can reach; the paragraph at the
// end is long enough to start the select-all these cases build from.
const LEADING_TABLE_DOC =
	'| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n\ntrailing paragraph\n';

interface Probe {
	/** The plugins route is only for gestures that a bundled plugin provides. */
	route: 'editor' | 'plugins';
	title: string;
	doc: string;
	/** The element the gesture aims at, waited for before the range is built. */
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
	'place-caret-at-point': {
		route: 'editor',
		title: 'a host shell’s placeCaretAtPoint lands a caret and ends the range',
		doc: PROSE_DOC
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
		doc: GRIP_DOC
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
	// Clicking a rendered block to open its source is the gesture whose missing reset cost a
	// whole document: it is the one path with no source text for the cross-block handler to
	// click into, so the rendered view has to end the range itself.
	'block-reveal-click': {
		route: 'plugins',
		title: 'a render-primary reveal click types into the reveal, not over the document',
		doc: BLOCK_MATH_DOC,
		ready: '.math-block-render'
	},
	// A table-of-contents entry places its caret through `rects.navigateTo` rather than through
	// any pointer path, so it lies outside what G2.12 can see.
	'toc-entry-click': {
		route: 'plugins',
		title: 'a TOC entry click types at the heading it navigated to',
		doc: TOC_DOC,
		ready: '.toc-block-nav'
	},
	'gap-caret-click': {
		route: 'editor',
		title: 'a click into a gap boundary ends the range and mints a paragraph there',
		doc: LEADING_TABLE_DOC,
		ready: '.table-block'
	}
};

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

	const ctx = await makeSimContext(page, editor, gesture, { errors });
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
		let editor: PluginsPage;

		test.beforeEach(async ({ page }) => {
			editor = new PluginsPage(page);
			await editor.gotoPlugins();
		});

		for (const [gesture, probe] of probesFor('plugins')) {
			test(`${gesture}: ${probe.title}`, async ({ page }) => {
				await runProbe(page, editor, gesture, probe);
			});
		}
	});
});
