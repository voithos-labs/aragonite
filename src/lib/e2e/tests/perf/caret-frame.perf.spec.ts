import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import { generateFixture, type FixtureShape } from '../../../test/perf/fixtures/generate';
import { waitForDocLength, writePerfResult } from './latency-harness';
import {
	installCaretFrameProbe,
	readCaretFrameProbe,
	resetCaretFrameProbe,
	type CaretFrameSummary
} from './caret-frame-harness';

declare const process: { env: Record<string, string | undefined> };

// The drawn caret lands in the frame the letter does, where the browser's caret would be
// (requirements/perf/caret-frame.md). Count rows: rows A and B need no baseline, row C gates on a
// blessed per-move count. They run under both perf scripts, the `perf:check` gate included.
test.skip(!process.env.PERF, 'run via `npm run perf:e2e` or `npm run perf:check`');

const ONE_MB = 1_000_000;
const KEYS = 30;

const ROWS: Array<{ shape: FixtureShape; mode: 'source' | 'live'; leaf: number[] }> = [
	{ shape: 'flat-prose', mode: 'source', leaf: [0] },
	{ shape: 'flat-prose', mode: 'live', leaf: [0] },
	{ shape: 'nested-containers', mode: 'live', leaf: [0, 0, 0] }
];

const baseline: { caretFrame?: { browserMoves?: { lagFramesPerMove: number } } } = JSON.parse(
	readFileSync('src/lib/test/perf/baseline.json', 'utf8')
);

async function loadRow(page: Page, editor: EditorPage, shape: FixtureShape, mode: string) {
	await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
	const fixture = generateFixture(shape, ONE_MB);
	await page.evaluate((c) => (window as any).__test.setSource(c), fixture);
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, 480_000);
	await editor.waitForRenderFlush();
	await installCaretFrameProbe(page);
}

/** Typed keys mid-word and at the leaf's end, then Enter and Backspace pairs. */
async function typeRun(page: Page, editor: EditorPage, leaf: number[]): Promise<CaretFrameSummary> {
	await editor.focusBlockAtPath(leaf, 3);
	await resetCaretFrameProbe(page);
	await editor.typeSlowly('x'.repeat(KEYS));
	const length = await page.evaluate((path) => {
		let node = (window as any).__test.getDocument();
		for (const index of path) node = node.children[index];
		return node.raw.replace(/\n$/, '').length as number;
	}, leaf);
	await editor.focusBlockAtPath(leaf, length);
	await editor.typeSlowly('y'.repeat(KEYS));
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Enter');
		await page.keyboard.press('Backspace');
	}
	return readCaretFrameProbe(page);
}

test.describe('caret frame: the drawn caret lands with the letter', () => {
	for (const { shape, mode, leaf } of ROWS) {
		const key = `${shape} 1MB ${mode}`;
		test(`rows A and B: ${key}`, async ({ page }) => {
			const editor = new EditorPage(page);
			await loadRow(page, editor, shape, mode);
			const run = await typeRun(page, editor, leaf);
			writePerfResult('PERF-CARET-FRAME', `caret-frame-typing-${shape}-${mode}`, run);

			expect(run.compared, 'the drawn caret drew while typing').toBeGreaterThan(0);
			expect(run.lagging, `${key}: frames where the caret trailed the letter`).toBe(0);
			expect(run.maxDeltaPx, `${key}: the drawn box against the range’s`).toBeLessThanOrEqual(1);
		});
	}
});

test.describe('caret frame: moves the browser makes', () => {
	test('row C: arrows, ArrowDown within a block and clicks', async ({ page }) => {
		const gate = baseline.caretFrame?.browserMoves?.lagFramesPerMove;
		if (gate === undefined) {
			throw new Error('caret-frame row C: no caretFrame.browserMoves in baseline.json; bless one');
		}
		const editor = new EditorPage(page);
		await loadRow(page, editor, 'flat-prose', 'source');
		// Block 2 is a paragraph long enough to wrap, so ArrowDown stays inside it.
		await editor.focusBlock(2, 0);
		await resetCaretFrameProbe(page);
		let moves = 0;
		for (let i = 0; i < 20; i++, moves++) await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 20; i++, moves++) await page.keyboard.press('ArrowLeft');
		for (let i = 0; i < 2; i++, moves++) await page.keyboard.press('ArrowDown');
		const box = (await editor.getBlock(2).boundingBox())!;
		for (let i = 0; i < 6; i++, moves++) {
			await page.mouse.click(box.x + 20 + i * 37, box.y + 6);
		}
		const run = await readCaretFrameProbe(page);
		const perMove = run.lagging / moves;
		writePerfResult('PERF-CARET-FRAME', 'caret-frame-browser-moves', { ...run, moves, perMove });

		expect(run.compared, 'the drawn caret drew while moving').toBeGreaterThan(0);
		expect(perMove, 'lagging frames per browser-made move').toBeLessThanOrEqual(gate);
	});
});
