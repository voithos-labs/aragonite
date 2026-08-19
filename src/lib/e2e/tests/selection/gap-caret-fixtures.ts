import type { EditorPage } from '../../editor-page';

// The documents whose block seams the gap caret parks in, and the gesture that arrives there.

export const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
export const FENCE = '```\ncode\n```\n';
/** paragraph, table, fencedCode, paragraph — the eligible boundary is 2. */
export const TABLE_THEN_FENCE = `para\n\n${TABLE}\n${FENCE}\ntail\n`;
/** paragraph, fencedCode, table, paragraph — same boundary, mirrored. */
export const FENCE_THEN_TABLE = `para\n\n${FENCE}\n${TABLE}\ntail\n`;
/** A leading table: the document's own start boundary, the one a click can reach. */
export const LEADING_TABLE = `${TABLE}\n${FENCE}\ntail\n`;

/** A table is ONE `data-block-path`; its cells are addressed row-major, so `d` is 3. */
export const LAST_CELL = 3;
/** End of the fence body, the offset whose forward Delete crosses the closer. */
export const CLOSER_BOUNDARY = 8;
export const AT_BOUNDARY = { parentPath: [], index: 2 };
export const AT_DOC_START = { parentPath: [], index: 0 };

/** The unit harness cannot see a windowing flush, so the windowed cases need a real slice. */
export const filler = (count: number, from: number) =>
	Array.from({ length: count }, (_, i) => `para ${from + i}\n`).join('\n');
export const WINDOWED = `${filler(100, 0)}\n${TABLE}\n${FENCE}\n${filler(100, 100)}`;

/** Click the table's last cell and step down onto the boundary below it. */
export async function arriveAtBoundary(editor: EditorPage): Promise<void> {
	await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
	await editor.page.keyboard.press('ArrowDown');
	await editor.bridge.waitForGapCaret(AT_BOUNDARY);
}

export async function loadThenArrive(editor: EditorPage): Promise<void> {
	await editor.loadContent(TABLE_THEN_FENCE);
	await arriveAtBoundary(editor);
}
