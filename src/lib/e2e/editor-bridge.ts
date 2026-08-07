import { type Page } from '@playwright/test';
import type { GapCaretPosition } from '../selection/gap-caret';
import type { EditorSelection } from '../selection/primitives';

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
	// tests stop the moment the assertion would pass. Each reads the bridge through a
	// guard: Playwright rejects a wait whose predicate THROWS, so a page that has not
	// installed its probes yet must read as "not settled" rather than dereference undefined.

	async waitForSourceContains(expected: string, timeout = 2000): Promise<void> {
		await this.waitForSourceWith((source, arg) => source.includes(arg), expected, timeout);
	}

	async waitForSourceNotContains(forbidden: string, timeout = 2000): Promise<void> {
		await this.waitForSourceWith((source, arg) => !source.includes(arg), forbidden, timeout);
	}

	async waitForSourceMatches(pattern: RegExp, timeout = 2000): Promise<void> {
		await this.waitForSourceWith(
			(source, arg) => new RegExp(arg.source, arg.flags).test(source),
			{ source: pattern.source, flags: pattern.flags },
			timeout
		);
	}

	async waitForSourceEquals(expected: string, timeout = 2000): Promise<void> {
		await this.waitForSourceWith((source, arg) => source === arg, expected, timeout);
	}

	async waitForBlockCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(e) => (window as any).__test?.getBlockCount() === e,
			expected,
			{ timeout, polling: 16 }
		);
	}

	async waitForSource(predicate: (source: string) => boolean, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(predSrc) => {
				const source = (window as any).__test?.getSource() as string | undefined;
				if (source === undefined) return false;
				return new Function('source', `return (${predSrc})(source);`)(source);
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
				const source = (window as any).__test?.getSource() as string | undefined;
				if (source === undefined) return false;
				const fn = new Function('source', 'arg', `return (${predSrc})(source, arg);`);
				return fn(source, value);
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

	// The third selection mode, same state-not-DOM rule as above: the gap's own surface
	// mounts a render later than the state write.
	async getGapCaret(): Promise<GapCaretPosition | null> {
		return this.page.evaluate(() => (window as any).__test.getGapCaret());
	}

	/** Settles on the gap an arrival gesture parks; `null` waits for one to end. */
	async waitForGapCaret(expected: GapCaretPosition | null, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(want) => {
				const probe = (window as any).__test?.getGapCaret;
				if (!probe) return false;
				const gap = probe() as { parentPath: number[]; index: number } | null;
				if (!want) return gap === null;
				return (
					!!gap &&
					gap.index === want.index &&
					JSON.stringify(gap.parentPath) === JSON.stringify(want.parentPath)
				);
			},
			expected,
			{ timeout, polling: 16 }
		);
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

	// The snapshot/restore pair, full fidelity — getSelectionPaths above projects
	// away the endpoint union's `cellCoordinate`, which a restore must carry back.

	async getSelection(): Promise<EditorSelection | null> {
		return this.page.evaluate(() => (window as any).__test.getSelection());
	}

	async setSelection(selection: EditorSelection): Promise<boolean> {
		return this.page.evaluate((sel) => (window as any).__test.setSelection(sel), selection);
	}
}
