import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { editorSelection, gutterLeftOf, nativeSelectionText } from './multi-click-helpers';
import { multiClick } from '../../multi-click';
import { dragSelection } from '../../selection-drag';
import { pointInGap, textRunCenter, textRunStart, type Point } from '../../text-runs';

// Every pointer gesture that turns a point into a block, at the same points
// (`requirements/selection/point-lookup-routes.md`).

const DOC = 'alpha beta gamma\n\n> quoted words here\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

interface Endpoints {
	anchor: { path: number[] };
	focus: { path: number[] };
}

test.describe('a point resolves to one block whichever gesture asks', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	// Drags with the button held, then waits for the range to settle on `expected`: the editor
	// takes pointer moves one per frame, so a read right after the last move can see an earlier one.
	async function sweep(from: Point, to: Point, expected: Partial<Endpoints>): Promise<void> {
		const page = editor.page;
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 12 });
		await editor.waitForCrossBlock(true);
		await expect.poll(() => editorSelection(page)).toMatchObject(expected);
		await page.mouse.up();
	}

	// The editor's padding left of block `index`, level with `y`.
	const leftMargin = (index: number, y: number) =>
		pointInGap(
			editor.editorContainer,
			editor.page.locator(`[data-block-path='${JSON.stringify([index])}']`),
			'left',
			y
		);

	test.describe("a press in a container's margin names the child level with it", () => {
		test('a drag from text into the gutter', async ({ page }) => {
			await sweep(await textRunStart(page, 'alpha'), await gutterLeftOf(page, 'quoted'), {
				focus: { path: [1, 0] }
			});
		});

		test('a drag from a cell into the gutter', async ({ page }) => {
			await sweep(await textRunCenter(page, '1'), await gutterLeftOf(page, 'quoted'), {
				focus: { path: [1, 0] }
			});
		});

		test('a margin drag starting level with the quote', async ({ page }) => {
			const quoted = await textRunCenter(page, 'quoted');
			await sweep(await leftMargin(1, quoted.y), await textRunCenter(page, 'beta'), {
				anchor: { path: [1, 0] }
			});
		});

		test('a triple-click in the gutter', async ({ page }) => {
			await multiClick(page, await gutterLeftOf(page, 'quoted'), 3);
			await expect.poll(() => nativeSelectionText(page)).toBe('quoted words here');
		});

		test('a word dropped in the gutter', async ({ page }) => {
			const beta = await textRunCenter(page, 'beta');
			await multiClick(page, beta, 2);
			await dragSelection(page, beta, await gutterLeftOf(page, 'quoted'));
			await editor.bridge.waitForSourceEquals(
				'alpha  gamma\n\n> betaquoted words here\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
			);
		});
	});

	test.describe('a drag from the margin into a table ends on a cell', () => {
		test('a margin drag', async ({ page }) => {
			const alpha = await textRunCenter(page, 'alpha');
			await sweep(await leftMargin(0, alpha.y), await textRunCenter(page, '2'), {
				anchor: { path: [0] },
				focus: { path: [2] }
			});
		});

		test('a drag from text', async ({ page }) => {
			await sweep(await textRunStart(page, 'alpha'), await textRunCenter(page, '2'), {
				anchor: { path: [0] },
				focus: { path: [2] }
			});
		});
	});
});
