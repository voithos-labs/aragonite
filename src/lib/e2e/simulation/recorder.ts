import type { Page } from '@playwright/test';
import type { EditorPage } from '../editor-page';

import { mkdirSync, writeFileSync } from 'node:fs';

export interface ManifestEntry {
	index: number;
	label: string;
	gesture: string;
	expectedSource: string;
	cstDump: string;
	selection: string;
	undoDepth: number;
	screenshot: string;
}

/**
 * Pairs a screenshot with the known editor state at each checkpoint, so a later reviewer can
 * judge what looks broken against the recorded source. The run directory is seed-derived with
 * no timestamp, so determinism extends to the artifacts, and it lives OUTSIDE `test-results/`
 * because Playwright wipes that at the start of every run.
 */
export class Recorder {
	private readonly entries: ManifestEntry[] = [];

	constructor(
		private readonly page: Page,
		private readonly editor: EditorPage,
		private readonly runDir: string
	) {}

	async checkpoint(label: string, gesture: string): Promise<void> {
		const index = this.entries.length;
		const screenshot = `${pad(index)}-${label}.png`;
		// Let any pending reactive render + layout flush before the screenshot so
		// the captured frame reflects settled state, not a mid-transition one.
		await this.editor.waitForRenderFlush();
		// Full-page, not viewport-only: a long note runs past the fold, and the
		// visual review needs the whole document at each checkpoint (a viewport
		// shot would clip trailing blocks like a standalone image at the end).
		await this.page.screenshot({
			path: `${this.runDir}/${screenshot}`,
			fullPage: true
		});
		const [expectedSource, cstDump, selection, undoStack] = await Promise.all([
			this.editor.bridge.getSource(),
			this.page.evaluate(() => (window as any).__test.dumpTree()),
			this.page.evaluate(() => (window as any).__test.dumpSelection()),
			this.page.evaluate(() => (window as any).__test.dumpUndoStack())
		]);
		this.entries.push({
			index,
			label,
			gesture,
			expectedSource,
			cstDump,
			selection,
			undoDepth: parseUndoDepth(undoStack),
			screenshot
		});
	}

	async finalize(): Promise<void> {
		mkdirSync(this.runDir, { recursive: true });
		writeFileSync(`${this.runDir}/manifest.json`, JSON.stringify(this.entries, null, 2));
	}
}

export function runDirForSeed(seed: number): string {
	return `simulation-captures/seed-${seed}`;
}

// ── Internal ────────────────────────────────────────────────────────────────

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

function parseUndoDepth(dump: string): number {
	const match = /undo-depth=(\d+)/.exec(dump);
	return match ? Number(match[1]) : 0;
}
