import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { SimContext } from '../../simulation/invariants';
import { mergeBackspaceAtStart } from '../../simulation/gestures/merge';
import { makeSimContext } from './helpers';

// Reachability self-tests: each asserts a REAL merge or container-exit unwrap happened,
// since a Backspace that no-oped would be an invisible hole in the corruption oracle. The
// negative case proves the no-predecessor guard fails loud.

function makeCtx(page: Page, editor: EditorPage): Promise<SimContext> {
	return makeSimContext(page, editor, 'reach');
}

test.describe('sim gesture reachability: merge', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The three merge shapes all collapse two top-level blocks into one.
	test('para→para merges block 1 into block 0', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getSource()).toContain('alphabeta');
	});

	test('para→heading: the paragraph is absorbed, the heading stays a heading', async ({ page }) => {
		await editor.loadContent('# Head\n\nbody\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
	});

	test('para→list: the paragraph merges into the list, dropping a top-level block', async ({
		page
	}) => {
		await editor.loadContent('- item\n\ntail\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getSource()).toContain('tail');
	});

	// The two unwrap shapes delegate to the container exit; they change the source
	// (a marker is dropped) without necessarily reducing the top-level count.
	test('list U1: Backspace at the first item unwraps it to a paragraph', async ({ page }) => {
		await editor.loadContent('Before\n\n- one\n- two\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- one/m);
		expect(source).toMatch(/^one/m);
		expect(source).toMatch(/^- two/m);
	});

	test('blockquote U2: Backspace at the first line lifts it out of the quote', async ({ page }) => {
		await editor.loadContent('Above\n\n> quote\n');
		await mergeBackspaceAtStart(await makeCtx(page, editor), [1]);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('> quote');
		expect(source).toContain('quote');
	});

	test("Backspace at the document's first block fails loudly (no predecessor)", async ({
		page
	}) => {
		await editor.loadContent('only\n\ntail\n');
		await expect(mergeBackspaceAtStart(await makeCtx(page, editor), [0])).rejects.toThrow(
			/left the source unchanged/
		);
	});
});
