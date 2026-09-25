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
 * judge what looks broken against the recorded source. The run directory is named after the
 * seed with no timestamp, so the files are reproducible too, and it sits outside
 * `test-results/`, which Playwright wipes at the start of every run.
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
		// Let any pending render and layout finish before the screenshot, so the captured
		// frame shows the settled state rather than one mid-change.
		await this.editor.waitForRenderFlush();
		// The full page, not just the viewport: a long note runs off screen, and the visual
		// review needs the whole document at each checkpoint.
		await this.page.screenshot({
			path: `${this.runDir}/${screenshot}`,
			fullPage: true
		});
		const [expectedSource, cstDump, selection, undoDepth] = await Promise.all([
			this.editor.bridge.getSource(),
			this.page.evaluate(() => (window as any).__test.dumpTree()),
			this.page.evaluate(() => (window as any).__test.dumpSelection()),
			this.editor.bridge.getUndoDepth()
		]);
		this.entries.push({
			index,
			label,
			gesture,
			expectedSource,
			cstDump,
			selection,
			undoDepth,
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
