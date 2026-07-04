import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probe surface for the Fork-A `:::note` reserved-chrome e2e suites
// (selection parity, reserved-index structural ops, the rangeDelete wall, and the
// wall × table branch). Every gate reads the CST/selection by path via
// `window.__test`, never visuals. Follows the details-helpers.ts precedent.

export class PluginsPage extends EditorPage {
	async gotoPlugins() {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, {
			timeout: 10_000
		});
	}
}

export interface NoteState {
	rootCount: number;
	kind: string;
	childCount: number;
	childKinds: string[];
	childTexts: string[];
	raw: string;
}

// Read the callout at root index `noteIndex` through the CST bridge. Trailing
// newlines are trimmed so childTexts read as visible text.
export async function readNote(page: Page, noteIndex: number): Promise<NoteState> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		const note = doc.children[i];
		return {
			rootCount: doc.children.length,
			kind: note?.kind ?? '',
			childCount: note?.children?.length ?? 0,
			childKinds: (note?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
			childTexts: (note?.children ?? []).map((c: { raw?: string }) =>
				(c.raw ?? '').replace(/\n+$/, '')
			),
			raw: note?.raw ?? ''
		};
	}, noteIndex);
}

// CST path of the block holding the current DOM caret — the observable oracle for
// "the caret landed in the title". Reads the focused contenteditable's wrapper.
export async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
}

export async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
}

export async function stateConsistencyViolations(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__test.auditBlockListStateConsistency());
}

// Paragraph above + a titled callout. Top-level: [0]=para "Above",
// [1]=callout; callout children: [1,0]=title "Title", [1,1]=para "Body".
export const FIXTURE = 'Above\n\n:::note Title\nBody\n:::\n';
