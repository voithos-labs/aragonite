import { type Page } from '@playwright/test';

export class EditorBridge {
	constructor(public page: Page) {}

	async getSource(): Promise<string> {
		return this.page.evaluate(() => (window as any).__test.getSource());
	}

	async getBlockCount(): Promise<number> {
		return this.page.evaluate(() => (window as any).__test.getBlockCount());
	}

	async getBlockKind(index: number): Promise<string> {
		return this.page.evaluate((i) => (window as any).__test.getBlockKind(i), index);
	}

	async getDomBlockCount(): Promise<number> {
		return this.page.locator('.block-list > .block-host > *:not(.selection-overlay)').count();
	}

	async isCrossBlockActive(): Promise<boolean> {
		return this.page.evaluate(() => {
			if ((window as any).__test?.isCrossBlockActive) {
				return (window as any).__test.isCrossBlockActive();
			}
			return document.querySelector('[data-cross-block]') !== null;
		});
	}

	async getSelectionPaths(): Promise<{
		anchor: { path: number[]; offset: number };
		focus: { path: number[]; offset: number };
	} | null> {
		return this.page.evaluate(() => {
			if ((window as any).__test?.getSelectionPaths) {
				return (window as any).__test.getSelectionPaths();
			}
			return null;
		});
	}

	async waitForCrossBlock(active: boolean): Promise<void> {
		if (active) {
			await this.page.waitForSelector('[data-cross-block]', { state: 'attached', timeout: 2000 });
		} else {
			await this.page.waitForSelector('[data-cross-block]', { state: 'detached', timeout: 2000 });
		}
	}
}
