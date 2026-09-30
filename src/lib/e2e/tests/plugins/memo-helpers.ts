import { expect } from '@playwright/test';
import { PluginsPage } from './helpers';

// The page object for the `%%` memo harness kind, on the `memo` seed, whose block [1] is the memo.

export class MemoPage extends PluginsPage {
	get memo() {
		return this.page.locator('.memo-block');
	}

	async gotoSeed(): Promise<void> {
		await this.gotoPlugins('memo');
		await expect(this.memo).toHaveCount(1);
		expect(await this.bridge.getBlockKind(1)).toBe('memo');
	}
}
