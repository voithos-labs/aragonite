// Regenerates the README's presentation-mode strips, so the picture cannot drift from the modes.
// Each panel is its own page load because the preview rungs only reveal around a FOCUSED caret and
// one document holds one focus; composing from data URIs keeps this dependency-free.
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { centerOfWord } from '../presentation/helpers';

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

// The middle and right panels park the caret in the SAME word: that pairing is the strip's whole
// argument, since preview-inline reveals the markers around it and live leaves them hidden.
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

// Cropped to a common band so three panels of differing natural height align; hidden markers
// reflow the text, so equal heights cannot be assumed.
const PANEL_HEIGHT_PX = 210;

function compositionHtml(shots: string[], theme: keyof typeof SURFACES): string {
	const { page, caption } = SURFACES[theme];
	const captions = PANELS.map((p) => `<figcaption>${p.caption}</figcaption>`).join('');
	const images = shots.map((src) => `<img src="data:image/png;base64,${src}" alt="">`).join('');
	return `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:${page}}
    .strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;padding:20px;width:1800px}
    figcaption{font:600 30px/1.3 ui-sans-serif,system-ui,sans-serif;color:${caption}}
    img{display:block;width:100%;height:${PANEL_HEIGHT_PX}px;object-fit:cover;object-position:top left;border-radius:6px}
  </style><div class="strip">${captions}${images}</div>`;
}

for (const theme of ['light', 'dark'] as const) {
	test(`presentation-mode strip — ${theme}`, async ({ page }) => {
		const shots: string[] = [];

		for (const { mode } of PANELS) {
			const ep = new EditorPage(page);
			// Handles off, default theme: a grip revealed in one panel and not another, or a theme
			// that differs between strips, reads as a difference between the modes.
			await ep.goto(`?presentationMode=${mode}&dragHandles=false`);
			await ep.loadContent(NOTE);

			if (mode !== 'source') {
				await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
				// The harness header sits above the editor, so the word can fall below the fold and a
				// raw-coordinate click would land on nothing.
				await ep.editorContainer.scrollIntoViewIfNeeded();
				const { x, y } = await centerOfWord(page, CARET_WORD);
				await page.mouse.click(x, y);
				// The reveal is caret-driven, so the shot is only honest once the caret has landed.
				await expect
					.poll(async () => (await ep.bridge.getSelectionPaths())?.focus.path.length ?? 0)
					.toBeGreaterThan(0);
				// Park the pointer off-canvas so no hover affordance paints into the shot.
				await page.mouse.move(0, 0);
			}
			shots.push((await ep.editorContainer.screenshot()).toString('base64'));
		}

		await page.setContent(compositionHtml(shots, theme));
		await page
			.locator('.strip')
			.screenshot({ path: `docs/assets/presentation-modes-${theme}.png`, scale: 'device' });
	});
}
