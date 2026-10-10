import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const HEADINGS = '# Heading 1\n\n## Heading 2\n\n### Heading 3\n';
const PARAGRAPHS = 'Para one.\n\nPara two.\n\nPara three.\n';
const MARKER_LEAD =
	'**bold one** rest of para.\n\n**bold two** rest of para.\n\n**bold three** rest of para.\n';
const MARKER_TAIL =
	'rest of para **bold one**\n\nrest of para **bold two**\n\nrest of para **bold three**\n';

/** Start at the far block and press ArrowDown twice, so the second keypress is the one that must
 *  cross. */
const DIRECTIONS = [
	{ key: 'ArrowUp', edge: 'first', start: 2, line: 0 },
	{ key: 'ArrowDown', edge: 'last', start: 0, line: 4 }
] as const;

test.describe('sticky column: rapid cross-block navigation (timing)', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The visual-line checks must see the block boundary under rapid input when the first or last
	// child is not a text node, or the browser's own arrow clamps inside the block.
	async function crossesRapidly(
		doc: string,
		{ key, start, line }: (typeof DIRECTIONS)[number]
	): Promise<void> {
		await editor.loadContent(doc);
		await editor.page.locator('[contenteditable="true"]').nth(start).click();
		await editor.page.keyboard.press('End');

		await editor.page.keyboard.press(key);
		await editor.page.keyboard.press(key);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('X');

		const lines = (await editor.bridge.getSource()).split('\n');
		expect(lines[line]).toContain('X');
	}

	/** Both directions of one document, each on a fresh load. */
	async function crossesBothWays(doc: (edge: 'first' | 'last') => string): Promise<void> {
		for (const direction of DIRECTIONS) {
			await test.step(`rapid ${direction.key} crosses to the ${direction.edge} block`, async () => {
				await crossesRapidly(doc(direction.edge), direction);
			});
		}
	}

	test('rapid arrows across headings cross to the first and last heading', () =>
		crossesBothWays(() => HEADINGS));

	// The control: plain text on both ends, where the block boundary is never in doubt.
	test('rapid arrows across plain paragraphs cross to the first and last', () =>
		crossesBothWays(() => PARAGRAPHS));

	// The dimmed `**` marker span as first or last child: the same non-text edge a heading has,
	// reached through inline markup instead of a block marker.
	test('rapid arrows across paragraphs whose edge child is a markup span', () =>
		crossesBothWays((edge) => (edge === 'first' ? MARKER_LEAD : MARKER_TAIL)));
});
