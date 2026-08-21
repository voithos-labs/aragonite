// Regenerates the README's presentation-mode strip (docs/assets/presentation-modes.png) from the
// real editor, so the picture cannot drift from the modes. Each panel is shot on its own page load
// because the two preview rungs only reveal around a FOCUSED caret, and one document can hold one
// focus; the panels are then composed in the browser from data URIs, which keeps this dependency-free.
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

// Cropped to a common band so three panels of differing natural height align; hidden markers
// reflow the text, so equal heights cannot be assumed.
const PANEL_HEIGHT_PX = 210;

function compositionHtml(shots: string[]): string {
	const captions = PANELS.map((p) => `<figcaption>${p.caption}</figcaption>`).join('');
	const images = shots.map((src) => `<img src="data:image/png;base64,${src}" alt="">`).join('');
	return `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#fff}
    .strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;padding:20px;width:1800px}
    figcaption{font:15px/1.4 ui-sans-serif,system-ui,sans-serif;color:#6b7280}
    img{display:block;width:100%;height:${PANEL_HEIGHT_PX}px;object-fit:cover;object-position:top left;border-radius:6px}
  </style><div class="strip">${captions}${images}</div>`;
}

test('presentation-mode strip', async ({ page }) => {
	const shots: string[] = [];

	for (const { mode } of PANELS) {
		const ep = new EditorPage(page);
		// Handles off: the strip is about marker visibility, and a hover-revealed grip in one
		// panel and not another reads as a difference between the modes.
		await ep.goto(`?presentationMode=${mode}&dragHandles=false`);
		await ep.loadContent(NOTE);
		if (mode === 'source') {
			await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		} else {
			await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
			// The harness header is above the editor, so the word can sit below the fold and a
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

	await page.setContent(compositionHtml(shots));
	await page
		.locator('.strip')
		.screenshot({ path: 'docs/assets/presentation-modes.png', scale: 'device' });
});
