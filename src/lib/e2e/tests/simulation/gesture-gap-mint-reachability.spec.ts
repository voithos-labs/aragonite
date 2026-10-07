import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import type { SimContext } from '../../simulation/invariants';
import { assertStructuralIntegrity } from '../../simulation/invariants';
import { mintAtGap } from '../../simulation/gestures/structure';
import { loadFresh, makeSimContext } from './helpers';

// Each step checks that a real paragraph appeared at the boundary, since a gesture that
// quietly typed into the block below would be an invisible hole in the coverage. The last step
// of each test shows the gesture throws at a boundary it cannot use.

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const FENCE = '```\ncode\n```\n';
/** table, fencedCode, paragraph: the eligible boundary is 1. */
const TABLE_THEN_FENCE = `${TABLE}\n${FENCE}\ntail\n`;
/** paragraph, fencedCode: a paragraph declares no edge, so boundary 1 is ineligible. */
const PARA_THEN_FENCE = `lead\n\n${FENCE}`;

function makeCtx(page: Page, editor: EditorPage): Promise<SimContext> {
	return makeSimContext(page, editor, 'reach');
}

test('sim gesture reachability: gap create', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();

	await test.step('typing at the gap inserts a paragraph between the two blocks', async () => {
		await loadFresh(editor, TABLE_THEN_FENCE);
		const ctx = await makeCtx(page, editor);

		await mintAtGap(ctx, 1, 'Q');

		expect(await editor.bridge.getSource()).toBe(`${TABLE}\nQ\n\n${FENCE}\ntail\n`);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await assertStructuralIntegrity(ctx);
	});

	await test.step('Enter at the gap inserts an empty paragraph the caret lands in', async () => {
		await loadFresh(editor, TABLE_THEN_FENCE);
		const ctx = await makeCtx(page, editor);

		await mintAtGap(ctx, 1, '');
		await editor.typeSlowly('Q');

		await editor.bridge.waitForSourceContains('\nQ\n');
		expect(await editor.bridge.getSource()).toBe(`${TABLE}\nQ\n\n${FENCE}\ntail\n`);
		await assertStructuralIntegrity(ctx);
	});

	// The gesture's own check: at a boundary it cannot use, Backspace merges as usual, and a gesture
	// that recorded that as a new block would cover nothing.
	await test.step('a boundary neither neighbour declares fails loudly', async () => {
		await loadFresh(editor, PARA_THEN_FENCE);

		await expect(mintAtGap(await makeCtx(page, editor), 1, 'Q')).rejects.toThrow(
			/no gap caret there/
		);
	});
});

// Opaque containers: the caret arrives by arrow-up, because Backspace on the first child of a
// container with a title row does nothing on purpose.
test('sim gesture reachability: gap create between opaque containers', async ({ page }) => {
	const CALLOUT_A = ':::note Alpha\nalpha\n:::\n';
	const CALLOUT_B = ':::tip Beta\nbeta\n:::\n';
	/** admonition, admonition, paragraph: the eligible boundary is 1. */
	const TWO_CALLOUTS = `${CALLOUT_A}\n${CALLOUT_B}\ntail\n`;

	const editor = new PluginsPage(page);
	await editor.gotoPlugins();

	await test.step('the arrow-up arrival creates a paragraph between the two callouts', async () => {
		await loadFresh(editor, TWO_CALLOUTS);
		const ctx = await makeSimContext(page, editor, 'reach-opaque');

		await mintAtGap(ctx, 1, 'Q', { arrival: 'arrow-up' });

		expect(await editor.bridge.getSource()).toBe(`${CALLOUT_A}\nQ\n\n${CALLOUT_B}\ntail\n`);
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		await assertStructuralIntegrity(ctx);
	});

	// Backspace on the callout's title does nothing by design, so arriving that way must throw
	// here rather than record it as a new block.
	await test.step('the backspace arrival fails loudly at a chrome-container boundary', async () => {
		await loadFresh(editor, TWO_CALLOUTS);
		await expect(
			mintAtGap(await makeSimContext(page, editor, 'reach-opaque'), 1, 'Q')
		).rejects.toThrow(/no gap caret there/);
	});
});
