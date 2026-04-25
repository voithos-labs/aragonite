import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('list Enter', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of item creates new sibling', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => ((s.match(/^- /gm) ?? []).length) >= 3);
		const markers = (await editor.bridge.getSource()).match(/^- /gm) ?? [];
		expect(markers.length).toBeGreaterThanOrEqual(3);
	});

	test('Enter in middle of item splits content', async () => {
		await editor.loadContent('- HelloWorld\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => s.includes('- Hello') && s.includes('- World'));
		const source = await editor.bridge.getSource();
		expect(source).toContain('- Hello');
		expect(source).toContain('- World');
	});

	// Regression: mid-item Enter used to push two undo snapshots; must collapse to one.
	test('Enter in middle of item: one Ctrl+Z restores original item', async () => {
		await editor.loadContent('- HelloWorld\n');
		const before = await editor.bridge.getSource();
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.page.keyboard.press('Home');
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('- Hello');
		expect(await editor.bridge.getSource()).toContain('- Hello');
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		expect(await editor.bridge.getSource()).toBe(before);
	});

	test('Enter on empty only item exits list', async () => {
		await editor.loadContent('- Only\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Only' });
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 200ms — empty-marker insert isn't visible in serialized source; let editor settle.
		await editor.page.waitForTimeout(200);
		await editor.page.keyboard.press('Enter');
		// wait 200ms — exit-list transition emits no immediate source change.
		await editor.page.waitForTimeout(200);
		await editor.typeText('After');
		await editor.bridge.waitForSourceContains('After');
		const source = await editor.bridge.getSource();
		expect(source).toContain('Only');
		expect(source).toContain('After');
		const afterIdx = source.indexOf('After');
		const lineStart = source.lastIndexOf('\n', afterIdx) + 1;
		expect(source.slice(lineStart, lineStart + 2)).not.toBe('- ');
	});

	test('Enter on empty first item creates paragraph before list', async () => {
		await editor.loadContent('- First\n- Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('- \n- First');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('Before');
		await editor.bridge.waitForSourceContains('Before');
		const source = await editor.bridge.getSource();
		expect(source.indexOf('Before')).toBeLessThan(source.indexOf('First'));
	});

	test('Enter on empty middle item places cursor between siblings', async () => {
		await editor.loadContent('- First\n- Second\n- Third\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'Second' });
		await second.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('Second'));
		await editor.page.keyboard.press('Enter');
		// wait 300ms — exiting empty middle item produces no source change until next type.
		await editor.page.waitForTimeout(300);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('Z');
		const source = await editor.bridge.getSource();
		expect(source.indexOf('Z')).toBeLessThan(source.indexOf('Third'));
	});

	test('Enter on empty item with nested content promotes nested items instead of dropping them', async () => {
		await editor.loadContent('- Item\n  - Nested\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item' }).first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — first Enter creates an empty sibling whose marker is trimmed in serialized source.
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^- Nested$/m);
		const source = await editor.bridge.getSource();
		expect(source).toContain('Item');
		expect(source).toContain('Nested');
		expect(source).toMatch(/^- Nested$/m);
		expect(source).not.toMatch(/^ {2,}- Nested$/m);
	});

	test('ordered: new item gets next number and subsequent renumber', async () => {
		await editor.loadContent('1. First\n2. Second\n3. Third\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\.\s*Second/m);
		await editor.typeText('New');
		await editor.bridge.waitForSourceMatches(/2\.\s*New/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/2\.\s*New/);
		expect(source).toMatch(/3\.\s*Second/);
		expect(source).toMatch(/4\.\s*Third/);
	});

	test('ordered: Enter at start of first item numbers correctly', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => {
			const numbers = (s.match(/^(\d+)\./gm) || []).map(Number);
			return numbers.length >= 2 && new Set(numbers).size === numbers.length;
		});
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/1\./);
		expect(source).toContain('First');
		const numbers = (source.match(/^(\d+)\./gm) || []).map(Number);
		const unique = new Set(numbers);
		expect(unique.size).toBe(numbers.length);
	});

	test('ordered: Enter on empty first item renumbers remaining list', async () => {
		await editor.loadContent('1. First\n2. Second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('First'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^1\. Second$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. Second$/m);
		expect(source).not.toMatch(/^2\. Second$/m);
	});

	// Google Docs / Obsidian semantics: exit paragraph doesn't consume a marker number.
	test('ordered: Enter on empty middle item renumbers second half continuously', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n4. four\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('three'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^3\. four$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. four$/m);
		expect(source).not.toMatch(/^4\. four$/m);
		expect(source).not.toMatch(/^1\. four$/m);
	});

	test('ordered: double-Enter at end of middle item exits with continuous numbering', async () => {
		await editor.loadContent('1. one\n2. two\n3. three\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'two' });
		await second.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^4\. three$/m);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => /^3\. three$/m.test(s) && !/^4\. three$/m.test(s));
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. three$/m);
		expect(source).not.toMatch(/^4\. three$/m);
	});

	test('Enter on empty last item creates paragraph after the list', async () => {
		await editor.loadContent('- First\n- Last\n');
		const last = editor.page.locator('[contenteditable="true"]', { hasText: 'Last' });
		await last.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('Last'));
		await editor.page.keyboard.press('Enter');
		// wait 300ms — exiting empty last item leaves no source change until next type.
		await editor.page.waitForTimeout(300);
		await editor.typeText('After');
		await editor.bridge.waitForSourceContains('After');
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- First$/m);
		expect(source).not.toMatch(/^- Last/m);
		expect(source).toContain('After');
		expect(source.indexOf('After')).toBeGreaterThan(source.indexOf('First'));
	});

	// Regression: trailing mismatched-type nested list used to vanish on exit.
	test('Enter on empty item with mismatched-type nested list lifts the sub-list', async () => {
		await editor.loadContent('- Item\n  1. NestedOrdered\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'Item' }).first();
		await item.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — first Enter inserts an empty marker that's trimmed in serialized source.
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^1\. NestedOrdered$/m);
		const source = await editor.bridge.getSource();
		expect(source).toContain('Item');
		expect(source).toContain('NestedOrdered');
		expect(source).toMatch(/^1\. NestedOrdered$/m);
		expect(source).not.toMatch(/^ {2,}1\. NestedOrdered$/m);
	});

	// Regression: non-list trailing children in loose items used to be dropped.
	test('Enter on emptied loose item lifts trailing paragraph as top-level block', async () => {
		await editor.loadContent('- First\n\n  second\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'First' });
		await first.click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSource((s) => !s.includes('First'));
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => !/^- second$/m.test(s) && !/^ {2,}second$/m.test(s));
		await editor.typeText('lead');
		await editor.bridge.waitForSourceContains('lead');
		const source = await editor.bridge.getSource();
		expect(source).toContain('second');
		expect(source).not.toMatch(/^- second$/m);
		expect(source).not.toMatch(/^ {2,}second$/m);
		expect(source.indexOf('lead')).toBeLessThan(source.indexOf('second'));
	});

	// Regression: Enter on an empty nested item used to escape into the
	// containing list item as a bare paragraph, leaving a trailing orphan
	// paragraph. Expected is Shift+Tab semantics — promote one level.
	test('Enter on empty nested item promotes to parent list instead of escaping', async () => {
		await editor.loadContent('- item\n  - nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'nested' });
		await nested.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — first Enter creates empty sibling whose marker is trimmed in source.
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^- $/m);
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^- X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^ {2}- nested$/m);
		// Promoted to outer list — "- X" at column 0, no indent.
		expect(source).toMatch(/^- X$/m);
		// The buggy path produced a bare "X" paragraph (no marker) instead.
		expect(source).not.toMatch(/^X$/m);
	});

	test('third Enter after promote exits the outer list to a paragraph', async () => {
		await editor.loadContent('- item\n  - nested\n');
		const nested = editor.page.locator('[contenteditable="true"]', { hasText: 'nested' });
		await nested.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — first Enter creates empty sibling whose marker is trimmed in source.
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceMatches(/^- $/m);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSource((s) => !/^- $/m.test(s));
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- item$/m);
		expect(source).toMatch(/^ {2}- nested$/m);
		// Escaped to document-level paragraph — no marker, no indent.
		expect(source).toMatch(/^X$/m);
		expect(source).not.toMatch(/^- X$/m);
		expect(source).not.toMatch(/^ {2}- X$/m);
	});

	test('Enter on empty 3-level-nested item promotes one level per press', async () => {
		await editor.loadContent('- a\n  - b\n    - c\n');
		const c = editor.page.locator('[contenteditable="true"]', { hasText: 'c' });
		await c.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — first Enter creates empty deepest-level sibling whose marker is trimmed.
		await editor.page.waitForTimeout(300);
		await editor.page.keyboard.press('Enter');
		// wait 300ms — promote-one-level transition leaves no source change until next type.
		await editor.page.waitForTimeout(300);
		await editor.typeText('X');
		await editor.bridge.waitForSourceMatches(/^ {2}- X$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^- a$/m);
		expect(source).toMatch(/^ {2}- b$/m);
		expect(source).toMatch(/^ {4}- c$/m);
		// Promoted from level 3 to level 2 — two-space indent.
		expect(source).toMatch(/^ {2}- X$/m);
		expect(source).not.toMatch(/^ {4}- X$/m);
	});

	test('ordered: Enter at end of last item in loose list appends continuing item', async () => {
		await editor.loadContent('1. one\n2. two\n\n3. three\n');
		const third = editor.page.locator('[contenteditable="true"]', { hasText: 'three' });
		await third.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		// wait 300ms — Enter at end appends an empty continuing item (marker trimmed).
		await editor.page.waitForTimeout(300);
		await editor.typeText('new');
		await editor.bridge.waitForSourceMatches(/^4\. new$/m);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/^1\. one$/m);
		expect(source).toMatch(/^2\. two$/m);
		expect(source).toMatch(/^3\. three$/m);
		expect(source).toMatch(/^4\. new$/m);
	});
});
