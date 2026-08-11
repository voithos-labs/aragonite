import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import type { SimContext } from '../../simulation/invariants';
import { assertStructuralIntegrity } from '../../simulation/invariants';
import { mintAtGap } from '../../simulation/gestures/structure';
import { makeSimContext } from './helpers';

// Reachability self-tests: each asserts a real paragraph appeared AT the boundary, since a
// gesture that quietly entered the block below would be an invisible hole in the corruption
// oracle. The negative case proves the ineligible-boundary guard fails loud.

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const FENCE = '```\ncode\n```\n';
/** table, fencedCode, paragraph: the eligible boundary is 1. */
const TABLE_THEN_FENCE = `${TABLE}\n${FENCE}\ntail\n`;
/** paragraph, fencedCode: a paragraph declares no edge, so boundary 1 is ineligible. */
const PARA_THEN_FENCE = `lead\n\n${FENCE}`;

function makeCtx(page: Page, editor: EditorPage): Promise<SimContext> {
	return makeSimContext(page, editor, 'reach');
}

test.describe('sim gesture reachability: gap mint', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing at the gap inserts a paragraph between the two blocks', async ({ page }) => {
		await editor.loadContent(TABLE_THEN_FENCE);
		const ctx = await makeCtx(page, editor);

		await mintAtGap(ctx, 1, 'Q');

		expect(await editor.bridge.getSource()).toBe(`${TABLE}\nQ\n\n${FENCE}\ntail\n`);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await assertStructuralIntegrity(ctx);
	});

	test('Enter at the gap inserts an empty paragraph the caret lands in', async ({ page }) => {
		await editor.loadContent(TABLE_THEN_FENCE);
		const ctx = await makeCtx(page, editor);

		await mintAtGap(ctx, 1, '');
		await editor.typeSlowly('Q');

		await editor.bridge.waitForSourceContains('\nQ\n');
		expect(await editor.bridge.getSource()).toBe(`${TABLE}\nQ\n\n${FENCE}\ntail\n`);
		await assertStructuralIntegrity(ctx);
	});

	// The gesture's own guard, not the editor's: at an ineligible boundary the Backspace
	// merges as it always did, and a gesture that recorded that as a mint would be coverage
	// for nothing.
	test('a boundary neither neighbour declares fails loudly', async ({ page }) => {
		await editor.loadContent(PARA_THEN_FENCE);

		await expect(mintAtGap(await makeCtx(page, editor), 1, 'Q')).rejects.toThrow(
			/parked no gap caret/
		);
	});
});

// The opaque-container tier (#93): the boundary needs the arrow-up arrival, because a chrome
// container's first-leaf Backspace is a deliberate no-op rather than an edge fallback.
test.describe('sim gesture reachability: gap mint between opaque containers', () => {
	const CALLOUT_A = ':::note Alpha\nalpha\n:::\n';
	const CALLOUT_B = ':::tip Beta\nbeta\n:::\n';
	/** admonition, admonition, paragraph: the eligible boundary is 1. */
	const TWO_CALLOUTS = `${CALLOUT_A}\n${CALLOUT_B}\ntail\n`;

	let editor: PluginsPage;
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await editor.loadContent(TWO_CALLOUTS);
	});

	test('the arrow-up arrival mints a paragraph between the two callouts', async ({ page }) => {
		const ctx = await makeSimContext(page, editor, 'reach-opaque');

		await mintAtGap(ctx, 1, 'Q', { arrival: 'arrow-up' });

		expect(await editor.bridge.getSource()).toBe(`${CALLOUT_A}\nQ\n\n${CALLOUT_B}\ntail\n`);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await assertStructuralIntegrity(ctx);
	});

	// Backspace at the callout's title no-ops by design, so the default arrival must fail
	// loud here rather than record chrome coverage as a mint.
	test('the backspace arrival fails loudly at a chrome-container boundary', async ({ page }) => {
		await expect(
			mintAtGap(await makeSimContext(page, editor, 'reach-opaque'), 1, 'Q')
		).rejects.toThrow(/parked no gap caret/);
	});
});
