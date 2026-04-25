import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../../editor-page';

test.describe('list Enter — exit list on empty item', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
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
});
