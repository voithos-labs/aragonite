import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const HEADINGS = '# Heading 1\n\n## Heading 2\n\n### Heading 3\n';
const PARAGRAPHS = 'Para one.\n\nPara two.\n\nPara three.\n';
const MARKER_LEAD =
	'**bold one** rest of para.\n\n**bold two** rest of para.\n\n**bold three** rest of para.\n';
const MARKER_TAIL =
	'rest of para **bold one**\n\nrest of para **bold two**\n\nrest of para **bold three**\n';

/** Start at the far block and press twice, so the second press is the one that must cross. */
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

	// Regression: isAtFirstVisualLine / isAtLastVisualLine missed the boundary signal
	// under rapid input when firstChild/lastChild is a non-text node (heading markers,
	// inline markup spans), causing the native arrow to clamp within the same block.
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

	for (const direction of DIRECTIONS) {
		test(`rapid ${direction.key} across headings crosses to the ${direction.edge} heading`, () =>
			crossesRapidly(HEADINGS, direction));
	}

	// The control: plain text on both ends, where the boundary signal was never in doubt.
	for (const direction of DIRECTIONS) {
		test(`rapid ${direction.key} across plain paragraphs crosses to the ${direction.edge}`, () =>
			crossesRapidly(PARAGRAPHS, direction));
	}

	// The dimmed `**` marker span as firstChild/lastChild — the same non-text edge headings have,
	// reached through inline markup instead of a block marker.
	for (const direction of DIRECTIONS) {
		test(`rapid ${direction.key} across paragraphs whose ${direction.edge} child is a markup span`, () =>
			crossesRapidly(direction.edge === 'first' ? MARKER_LEAD : MARKER_TAIL, direction));
	}
});
