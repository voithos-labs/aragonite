import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('list Backspace', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace deletes empty first item', async () => {
		await editor.loadContent('- \n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]').first();
		await first.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) || []).length === 1);
		const source = await editor.bridge.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(1);
		expect(source).toContain('Second');
	});

	test('Backspace at start of non-empty first item unwraps to a plain paragraph', async () => {
		await editor.loadContent('Before\n\n- Item one\n- Item two\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item one' });
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^Item one/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^Item one/m);
		expect(source).toMatch(/^- Item two/m);
		expect(source).toContain('Before');
	});

	test('Backspace on single-item list (non-empty) removes the list entirely and lands cursor at the lifted paragraph', async () => {
		await editor.loadContent('- Solo\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^- /m.test(s));

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- /m);
		expect(source).toContain('Solo');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('ZSolo');
		const after = await editor.bridge.getSource();
		expect(after).toContain('ZSolo');
	});

	test('Backspace on first item with matching-type nested sub-list: nested items promote to parent list level', async () => {
		await editor.loadContent('- First\n  - Nested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^First/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).toMatch(/^- Nested/m);
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item with mismatched-type nested sub-list: sub-list becomes separate block', async () => {
		await editor.loadContent('- First\n  1. OrderedNested\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^First/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).toMatch(/^1\. OrderedNested/m);
		expect(source).toMatch(/^- Second/m);
	});

	test('Backspace on first item of ordered list: remaining items renumber from base', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' }).first();
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^1\. Second/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^First/m);
		expect(source).not.toMatch(/^1\. First/m);
		expect(source).toMatch(/^1\. Second/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	test('Backspace deletes empty non-first item', async () => {
		await editor.loadContent('- First\n- Second\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 200ms — Enter inserts an empty trailing item whose marker isn't visible in source.
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => (s.match(/^- /gm) || []).length === 2);
		const source = await editor.bridge.getSource();
		expect((source.match(/^- /gm) || []).length).toBe(2);
	});

	test('Backspace at start of non-empty non-first item merges into previous item (rule B: deepest visible above)', async () => {
		await editor.loadContent('- Item one\n- Item two\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Item two' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('Item oneItem two');

		const source = await editor.bridge.getSource();
		expect(source).toContain('Item oneItem two');
		expect((source.match(/^- /gm) ?? []).length).toBe(1);
	});

	test('M1 row 2: current item has nested sub-list; nested absorbed into target', async () => {
		await editor.loadContent('- A\n- B\n  - C\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- AB');

		const source = await editor.bridge.getSource();
		expect(source).toContain('- AB');
		expect(source).toMatch(/^\s+- C/m);
	});

	test('M1 row 3: target nested in previous item; current-item nested children become sibling of target (preserve absolute indent)', async () => {
		await editor.loadContent('- A\n  - AA\n- B\n  - C\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/- AAB/);

		const source = await editor.bridge.getSource();
		expect(source).toContain('- A');
		expect(source).toMatch(/- AAB/);
		expect(source).toMatch(/- AAB\s*\n\s+- C/);
	});

	test('M1 row 4 (deep nesting): E preserves its original absolute depth of 1, sibling of B', async () => {
		const content = '- A\n  - B\n    - C\n- D\n  - E\n';
		await editor.loadContent(content);
		const dItem = editor.page.locator('[contenteditable="true"]', { hasText: 'D' }).first();
		await dItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^    - CD/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^    - CD/m);
		expect(source).toMatch(/^  - B/m);
		expect(source).toMatch(/^  - E/m);
	});

	test('M1 row 5: current item has non-listItem continuation paragraph; absorbed into target item children', async () => {
		await editor.loadContent('- A\n- B\n\n  extra\n');
		const bItem = editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).first();
		await bItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- AB');

		const source = await editor.bridge.getSource();
		expect(source).toContain('- AB');
		expect(source).toMatch(/extra/);
	});

	test('M1 ordered list: merged item deletion renumbers remaining', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^1\. FirstSecond/m);

		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. FirstSecond/m);
		expect(source).toMatch(/^2\. Third/m);
	});

	test('M1 cursor lands at merge point in target', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const betaItem = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await betaItem.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('AlphaBeta');

		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AlphaZBeta');
		const source = await editor.bridge.getSource();
		expect(source).toContain('AlphaZBeta');
	});

	test('Backspace at start of nested item promotes it', async () => {
		await editor.loadContent('- Parent\n  - Nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'Nested' });
		await nested.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('- Parent\n- Nested\n');
		const source = await editor.bridge.getSource();
		expect(source).toContain('- Parent\n- Nested\n');
	});

	test('Backspace on empty only item deletes the entire list', async () => {
		await editor.loadContent('Above\n\n- \n\nBelow\n');
		const item = editor.page.locator('[contenteditable="true"]').nth(1);
		await item.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^- /m.test(s));

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- /m);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AboveZ');
		expect(await editor.bridge.getSource()).toContain('AboveZ');
	});

	test('Backspace on empty only item when list is first block deletes the list', async () => {
		await editor.loadContent('- \n\nAfter\n');
		const item = editor.page.locator('[contenteditable="true"]').first();
		await item.click();
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSource((s) => !/^- /m.test(s));

		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^- /m);
		expect(source).toContain('After');
	});

	// Contract pin: forward-delete at end of a non-last item is a silent no-op.
	// List items are structural peers, not prose continuations.
	test('Delete at end of non-last item is a no-op (list items do not concat via forward delete)', async () => {
		await editor.loadContent('- first\n- middle\n- last\n');
		const middle = editor.page.locator('[contenteditable="true"]', { hasText: 'middle' });
		await middle.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Delete');
		// wait 200ms — no-op produces no source change; verify state is stable before asserting.
		await editor.bridge.waitForSourceMatches(/^- first$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- first$/m);
		expect(source).toMatch(/^- middle$/m);
		expect(source).toMatch(/^- last$/m);
		expect(source).not.toMatch(/middlelast/);
	});

	test('Delete at end of last item merges following paragraph into the last item', async () => {
		await editor.loadContent('- first\n- last item\n\nAfter\n');
		const last = editor.page.locator('[contenteditable="true"]', { hasText: 'last item' });
		await last.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceMatches(/^- last itemAfter$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- last itemAfter$/m);
		expect(source).not.toMatch(/^After$/m);
	});

	test('ordered: deleting item renumbers subsequent', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 200ms — Enter at end inserts an empty trailing marker not visible in source.
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/3\.\s*Third/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/1\.\s*First/);
		expect(source).toMatch(/2\.\s*Second/);
		expect(source).toMatch(/3\.\s*Third/);
	});

	// J3 regression: nested mergeWithPrevious for innerIndex<=0 must await the
	// upward delegation. Pre-fix, the typed marker raced the merge — landing on
	// a stale block before the parent merge published.
	test('Backspace at start of nested-list item then immediate type lands character at merge boundary', async () => {
		await editor.loadContent('- Outer\n  - Inner one\n  - Inner two\n');
		const innerTwo = editor.page.locator('[contenteditable="true"]', { hasText: 'Inner two' });
		await innerTwo.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Inner oneZInner two');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Inner oneZInner two');
	});

	// J3 regression: same shape, flat list — Backspace then type with no settle
	// pause. The character must land at the merge boundary, not race to a stale
	// block.
	test('Backspace at start of non-first item then immediate type lands at merge boundary (no settle wait)', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const beta = editor.page.locator('[contenteditable="true"]', { hasText: 'Beta' });
		await beta.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('AlphaZBeta');
		const source = await editor.bridge.getSource();
		expect(source).toContain('AlphaZBeta');
	});

	// Google Docs semantics: post-blank item promotes to paragraph, remaining items continue the sequence (no Obsidian restart).
	test('ordered: Backspace on post-blank item promotes to paragraph and continues numbering', async () => {
		await editor.loadContent('1. one\n2. two\n\n3. three\n4. four\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceMatches(/^three$/m);
		const source = await editor.bridge.getSource();
		expect(source).not.toMatch(/^\d+\. three$/m);
		expect(source).toMatch(/^three$/m);
		expect(source).toMatch(/^3\. four$/m);
		expect(source).not.toMatch(/^4\. four$/m);
		expect(source).not.toMatch(/^1\. four$/m);
	});
});
