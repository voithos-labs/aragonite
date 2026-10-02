// Regenerates the README's presentation-mode strips, so the picture cannot drift from the modes.
// Each panel is its own page load, because the preview modes show markers only around a focused
// caret and one document has one focus; building the strip from data URIs keeps this free of
// dependencies.
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { textRunCenter } from '../../text-runs';

declare const process: { env: Record<string, string | undefined> };

test.skip(!process.env.DOCS_CAPTURE, 'run via `npm run docs:capture:modes`');

const NOTE = [
	'## Tide pool field notes',
	'',
	'The **anemones** close when shadowed, but the *hermit crabs* could not care less.',
	'',
	'- [x] sample the north pool',
	'- [ ] photograph the chitons at `station 4`',
	'',
	'> Low tide tomorrow at 6:40, bring the macro lens.',
	''
].join('\n');

// The middle and right panels put the caret in the same word, which is the strip's whole point:
// preview-inline shows the markers around it and live mode leaves them hidden.
const CARET_WORD = 'anemones';

const PANELS = [
	{ mode: 'source', caption: 'source' },
	{ mode: 'preview-inline', caption: 'preview-inline, caret in the bold word' },
	{ mode: 'live', caption: 'live, caret in the same word' }
] as const;

// Shared with the README's charts (scripts/chart-common.mjs) so the assets read as one set.
const SURFACES = {
	light: { page: '#fcfcfb', caption: '#52514e' },
	dark: { page: '#1a1a19', caption: '#c3c2b7' }
} as const;

// Hidden markers reflow the text, so each mode's note has its own height; every panel is shot at
// the tallest, so the three line up and nothing is cropped.
function compositionHtml(shots: string[], theme: keyof typeof SURFACES): string {
	const { page, caption } = SURFACES[theme];
	const captions = PANELS.map((p) => `<figcaption>${p.caption}</figcaption>`).join('');
	const images = shots.map((src) => `<img src="data:image/png;base64,${src}" alt="">`).join('');
	return `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:${page}}
    .strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;padding:20px;width:1800px}
    figcaption{font:600 30px/1.3 ui-sans-serif,system-ui,sans-serif;color:${caption}}
    img{display:block;width:100%;height:auto;border-radius:6px}
  </style><div class="strip">${captions}${images}</div>`;
}

/** One mode's editor holding the note, the caret in the bold word, sized to the note. */
async function openPanel(page: Page, mode: (typeof PANELS)[number]['mode']): Promise<EditorPage> {
	const ep = new EditorPage(page);
	// Drag handles off and the default theme, so neither reads as a difference between the modes.
	await ep.goto(`?presentationMode=${mode}&dragHandles=false`);
	await ep.loadContent(NOTE);

	if (mode !== 'source') {
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
		// The harness header sits above the editor, so the word can fall off screen and a click at
		// fixed coordinates would land on nothing.
		await ep.editorContainer.scrollIntoViewIfNeeded();
		const { x, y } = await textRunCenter(page, CARET_WORD);
		await page.mouse.click(x, y);
		// The markers appear around the caret, so the shot is only honest once it has landed.
		await expect
			.poll(async () => (await ep.bridge.getSelectionPaths())?.focus.path.length ?? 0)
			.toBeGreaterThan(0);
		// Move the pointer off the page, so nothing that appears on hover gets into the shot.
		await page.mouse.move(0, 0);
	}
	// The harness gives the editor a minimum height; the panel is the note, not the empty box.
	await ep.editorContainer.evaluate((el) => {
		el.style.minHeight = '0';
		el.style.height = 'auto';
		el.style.flex = 'none';
	});
	return ep;
}

for (const theme of ['light', 'dark'] as const) {
	test(`presentation-mode strip: ${theme}`, async ({ page }) => {
		let tallest = 0;
		for (const { mode } of PANELS) {
			const ep = await openPanel(page, mode);
			const height = await ep.editorContainer.evaluate((el) => el.getBoundingClientRect().height);
			tallest = Math.max(tallest, height);
		}

		const shots: string[] = [];
		for (const { mode } of PANELS) {
			const ep = await openPanel(page, mode);
			// The editor paints the extra room itself, so a shorter panel matches the tallest exactly.
			await ep.editorContainer.evaluate((el, px) => (el.style.minHeight = `${px}px`), tallest);
			shots.push((await ep.editorContainer.screenshot()).toString('base64'));
		}

		await page.setContent(compositionHtml(shots, theme));
		await page
			.locator('.strip')
			.screenshot({ path: `docs/assets/presentation-modes-${theme}.png`, scale: 'device' });
	});
}
