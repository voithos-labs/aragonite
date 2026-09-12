import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { waitForEditorHydrated } from '../../page-probes';
import { writePerfResult } from './latency-harness';
import {
	installProbe,
	runPass,
	summarize,
	topSelfTime,
	type Pass,
	type Profile
} from './scroll-harness';

declare const process: { env: Record<string, string | undefined> };

// Report-only, like the typing rows: what a wheel tick costs in live mode over a document
// whose blocks are the heavy kinds. The numbers are per tick, so a hitch reads as a long task
// or a frame gap, and a thrash as mounts plus unmounts far above the blocks a tick scrolls past.
test.skip(
	!process.env.PERF || !!process.env.PERF_GATE,
	'report-only — run via `npm run perf:e2e`; the perf:check gate skips these'
);

// One notch of a mouse wheel; a fling is several notches in one event.
const NOTCH_PX = 120;
const FLING_PX = 600;

const CODE = [
	'export function scan(input) {',
	'\tconst out = [];',
	'\tfor (const ch of input) {',
	'\t\tif (ch === "\\n") out.push(ch.charCodeAt(0));',
	'\t\telse if (/\\s/.test(ch)) continue;',
	'\t\telse out.push(ch);',
	'\t}',
	'\treturn out.join("");',
	'}'
].join('\n');

function section(i: number, withMath: boolean, withDiagram: boolean): string {
	const parts = [
		`## Section ${i}`,
		`Prose ahead of the fence in section ${i}, with **bold**, \`code\` and a [link](https://example.com).`,
		'```js',
		CODE,
		'```'
	];
	// Distinct per section: a repeated formula hits the render memo and measures nothing.
	if (withMath)
		parts.push('$$', `\\sum_{k=0}^{${i}} \\frac{x_k^2}{${i + 1}} + \\int_0^{${i}} f(t)\\,dt`, '$$');
	if (withDiagram)
		parts.push(
			'```mermaid',
			`graph TD\n\tA${i}[Start] --> B${i}[Middle]\n\tB${i} --> C${i}[End]`,
			'```'
		);
	parts.push(`Prose after the fence, ${i}.`, `- item one of ${i}`, `- item two of ${i}`);
	return parts.join('\n\n');
}

const CODE_PROSE = Array.from({ length: 150 }, (_, i) => section(i, false, false)).join('\n\n');
const MATH_CODE_DIAGRAMS = Array.from({ length: 120 }, (_, i) =>
	section(i, true, i % 10 === 0)
).join('\n\n');

const DOWN_UP: Pass[] = [
	{ name: 'down', ticks: 60, px: NOTCH_PX },
	{ name: 'up', ticks: 60, px: -NOTCH_PX }
];
const FLING: Pass[] = [
	{ name: 'fling-down', ticks: 20, px: FLING_PX },
	{ name: 'fling-up', ticks: 20, px: -FLING_PX }
];

async function measure(page: Page, editor: EditorPage, row: string, passes: Pass[]): Promise<void> {
	await editor.waitForRenderFlush();
	await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');
	const windowing = await editor.editorContainer.getAttribute('data-windowing');
	const blocks = await page.evaluate(
		() => (window as any).__test?.getDocument().children.length ?? null
	);
	await installProbe(page);

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
	await cdp.send('Profiler.start');
	const results: Record<string, ReturnType<typeof summarize>> = {};
	for (const pass of passes) results[pass.name] = summarize(await runPass(page, editor, pass));
	const { profile } = (await cdp.send('Profiler.stop')) as { profile: Profile };
	await cdp.detach();

	writePerfResult('PERF-SCROLL', `scroll-hitch-${row}`, {
		row,
		windowing,
		blocks,
		passes: results,
		topSelfTimeMs: topSelfTime(profile, 20)
	});
}

test.describe('scroll hitch — a wheel tick in live mode over heavy blocks', () => {
	test('code and prose on the editor route', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(CODE_PROSE);
		await measure(page, editor, 'code-prose', DOWN_UP);
	});

	// The caret pin: everything between the focused block and the viewport stays mounted up to
	// the pin cap, then the pin lets go and drops it all in one flush.
	test('code and prose with the caret parked near the top', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(CODE_PROSE);
		await editor.clickBlock(1);
		await measure(page, editor, 'code-prose-focused', [
			{ name: 'down', ticks: 150, px: NOTCH_PX },
			{ name: 'up', ticks: 150, px: -NOTCH_PX }
		]);
	});

	test('code and prose under a fling', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(CODE_PROSE);
		await measure(page, editor, 'code-prose-fling', FLING);
	});

	test('math, code and diagrams on the plugins route', async ({ page }) => {
		await page.goto('/test/plugins');
		await page.waitForFunction(() => (window as any).__test !== undefined);
		const editor = new EditorPage(page);
		await editor.loadContent(MATH_CODE_DIAGRAMS);
		await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
		await measure(page, editor, 'math-code-diagrams', DOWN_UP);
	});

	// The showcase as shipped: its own document, every demo plugin, the live-only toolbars.
	// Twice: with a caret in the first block, which pins everything between it and the viewport,
	// and without one, where the window moves freely.
	for (const focused of [true, false]) {
		test(`the showcase document on the demo route, ${focused ? 'caret parked' : 'no caret'}`, async ({
			page
		}) => {
			await page.goto('/');
			await waitForEditorHydrated(page);
			const editor = new EditorPage(page);
			if (focused) await page.locator('.editor [data-block-path]').first().click();
			await measure(page, editor, focused ? 'showcase-focused' : 'showcase', DOWN_UP);
		});
	}
});
