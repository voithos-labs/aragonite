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

	// ── Settling Predicates ─────────────────────────────────────────────
	// Use these instead of waitForTimeout to wait for editor state to
	// reach a specific shape. Predicates poll the source/block bridge so
	// tests stop the moment the assertion would pass.

	async waitForSourceContains(expected: string, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(e) => ((window as any).__test.getSource() as string).includes(e),
			expected,
			{ timeout, polling: 16 }
		);
	}

	async waitForSourceNotContains(forbidden: string, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(e) => !((window as any).__test.getSource() as string).includes(e),
			forbidden,
			{ timeout, polling: 16 }
		);
	}

	async waitForSourceMatches(pattern: RegExp, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(p) => new RegExp(p.source, p.flags).test((window as any).__test.getSource() as string),
			{ source: pattern.source, flags: pattern.flags },
			{ timeout, polling: 16 }
		);
	}

	async waitForSourceEquals(expected: string, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(e) => ((window as any).__test.getSource() as string) === e,
			expected,
			{ timeout, polling: 16 }
		);
	}

	async waitForBlockCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(e) => ((window as any).__test.getBlockCount() as number) === e,
			expected,
			{ timeout, polling: 16 }
		);
	}

	async waitForSource(predicate: (source: string) => boolean, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(predSrc) => {
				const fn = new Function('source', `return (${predSrc})(source);`);
				return fn((window as any).__test.getSource() as string);
			},
			predicate.toString(),
			{ timeout, polling: 16 }
		);
	}

	async waitForSourceWith<T>(
		predicate: (source: string, arg: T) => boolean,
		arg: T,
		timeout = 2000
	): Promise<void> {
		await this.page.waitForFunction(
			({ predSrc, value }) => {
				const fn = new Function('source', 'arg', `return (${predSrc})(source, arg);`);
				return fn((window as any).__test.getSource() as string, value);
			},
			{ predSrc: predicate.toString(), value: arg as any },
			{ timeout, polling: 16 }
		);
	}

	// Answers from SelectionState via the probe. The `[data-cross-block]` attribute
	// is a deferred mirror of that state, so a DOM read can report `false` while the
	// selection is already cross-block — the exact direction most specs assert.
	async isCrossBlockActive(): Promise<boolean> {
		return this.page.evaluate(() => (window as any).__test.isCrossBlockActive());
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
}
