import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { SimContext } from '../../simulation/invariants';
import { mergeBackspaceAtStart } from '../../simulation/gestures/merge';
import { makeSimContext } from './helpers';

// Each step checks that a real merge, or a real exit from a container, happened, since a
// Backspace that did nothing would be an invisible hole in the coverage. The last step shows
// the gesture throws when there is no block above.

function makeCtx(page: Page, editor: EditorPage): Promise<SimContext> {
	return makeSimContext(page, editor, 'reach');
}

test('sim gesture reachability: every merge shape merges or exits, and a no-op fails loudly', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto();

	// The three top-level merge shapes all collapse two top-level blocks into one.
	await test.step('para→para merges block 1 into block 0', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getSource()).toContain('alphabeta');
	});

	await test.step('para→heading: the paragraph is absorbed, the heading stays a heading', async () => {
		await editor.loadContent('# Head\n\nbody\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	await test.step('para→list: the paragraph merges into the list, dropping a top-level block', async () => {
		await editor.loadContent('- item\n\ntail\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getSource()).toContain('tail');
	});

	// A list item's merge target can be a heading, which the gesture must join rather than refuse.
	await test.step('list M1 under a heading item joins', async () => {
		await editor.loadContent('- # Plan\n- next\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [0, 1, 0]);
		expect(await editor.bridge.getSource()).toBe('- # Plannext\n');
	});

	// The two unwrap cases leave the container instead: they change the source, since a marker
	// goes, without necessarily reducing the number of top-level blocks.
	await test.step('list U1: Backspace at the first item unwraps it to a paragraph', async () => {
		await editor.loadContent('Before\n\n- one\n- two\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- one/m);
		expect(source).toMatch(/^one/m);
		expect(source).toMatch(/^- two/m);
	});

	await test.step('blockquote U2: Backspace at the first line lifts it out of the quote', async () => {
		await editor.loadContent('Above\n\n> quote\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('> quote');
		expect(source).toContain('quote');
	});

	await test.step("Backspace at the document's first block fails loudly (no predecessor)", async () => {
		await editor.loadContent('only\n\ntail\n');
		await expect(mergeBackspaceAtStart(await makeCtx(page, editor), [0])).rejects.toThrow(
			/left the source unchanged/
		);
	});
});
