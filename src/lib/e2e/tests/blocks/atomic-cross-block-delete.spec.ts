import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { waitForClipboardContains } from '../clipboard/complex-copy-paste/helpers';

const CODE_FIXTURE = 'before alpha\n\n```\nconst x = 42;\n```\n\nafter omega\n';
const BREAK_FIXTURE = 'before alpha\n\n---\n\nafter omega\n';

// Scoped to a window the caller opens with `clear()`: the test page's benign load-time 404 would
// trip a whole-session collector. Invariant fires are owned by the shared `[invariant:…]` fixture.
function opWindowErrors(page: Page): { clear: () => void; collected: () => string[] } {
	let errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});
	return { clear: () => (errors = []), collected: () => errors };
}

// Drag is the real gesture; geometry can vary, so fall back to a shift-click at the same focus
// offset. Both endpoints keep prose, so the focus-side leftover must merge — the `4after` fusion
// class.
async function selectAcrossAtomic(editor: EditorPage): Promise<void> {
	await editor.dragFromTo([0], 7, [2], 6);
	if (await editor.bridge.isCrossBlockActive()) return;
	await editor.focusBlockAtPath([0], 7);
	await editor.shiftClickBlock([2], 6);
}

test.describe('cross-block delete + cut through an atomic leaf block', () => {
	let editor: EditorPage;
	let errors: ReturnType<typeof opWindowErrors>;

	test.beforeEach(async ({ page }) => {
		errors = opWindowErrors(page);
		editor = new EditorPage(page);
		await editor.goto();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	async function assertNoOpErrors(): Promise<void> {
		const editorErrors: string[] = await editor.page.evaluate(() =>
			(window as any).__test.getCapturedErrors()
		);
		const all = [...errors.collected(), ...editorErrors.map((o) => `editor error: ${o}`)];
		expect(all, `errors during op:\n${all.join('\n')}`).toEqual([]);
	}

	for (const variant of [
		{ name: 'fenced code block', fixture: CODE_FIXTURE, kind: 'fencedCode', body: 'const x = 42;' },
		{ name: 'thematic break', fixture: BREAK_FIXTURE, kind: 'thematicBreak', body: '---' }
	] as const) {
		test(`delete spanning a ${variant.name} leaves sound merged prose, no fusion`, async () => {
			await editor.loadContent(variant.fixture);
			expect(await editor.bridge.getBlockCount()).toBe(3);
			expect(await editor.bridge.getBlockKind(1)).toBe(variant.kind);

			await selectAcrossAtomic(editor);
			await editor.waitForCrossBlock(true);
			errors.clear();
			await editor.page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceNotContains(variant.body);

			await assertSoundProse(editor, variant.body);
			await assertNoOpErrors();
		});

		test(`cut spanning a ${variant.name} removes the span and copies it once`, async () => {
			await editor.loadContent(variant.fixture);
			expect(await editor.bridge.getBlockCount()).toBe(3);
			expect(await editor.bridge.getBlockKind(1)).toBe(variant.kind);

			await selectAcrossAtomic(editor);
			await editor.waitForCrossBlock(true);
			errors.clear();
			await editor.page.keyboard.press('Control+x');
			await editor.bridge.waitForSourceNotContains(variant.body);

			await waitForClipboardContains(editor, variant.body);
			const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
			expect(clip).toContain(variant.body);

			await assertSoundProse(editor, variant.body);
			await assertNoOpErrors();
		});
	}
});

// roundTrip is the serializer-corruption backstop; parseConverged is the live-tree oracle — a
// delete that leaves a stale grid or split separator diverges from a reparse where the byte check
// is blind.
async function assertSoundProse(editor: EditorPage, body: string): Promise<void> {
	const source = await editor.bridge.getSource();
	expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	expect(await editor.parseConverged()).toBe(true);
	expect(source).not.toContain(body);
	expect(source).not.toContain('```');
	expect(source).toContain('before');
	expect(source).toContain('omega');
	expect(await editor.bridge.getBlockCount()).toBe(1);
	expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
}
