import { expect, type Page } from '@playwright/test';
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

	/** How many entries the undo stack holds. */
	async getUndoDepth(): Promise<number> {
		return this.page.evaluate(() => (window as any).__test.undoDepth());
	}

	// ── Waits on editor state ───────────────────────────────────────────
	// Every read is guarded because Playwright rejects a wait whose predicate throws, so a page
	// that has not installed `window.__test` yet reads as not ready.

	async waitForSourceContains(expected: string, timeout = 5000): Promise<void> {
		await this.waitForSourceWith((source, arg) => source.includes(arg), expected, timeout);
	}

	async waitForSourceNotContains(forbidden: string, timeout = 5000): Promise<void> {
		await this.waitForSourceWith((source, arg) => !source.includes(arg), forbidden, timeout);
	}

	async waitForSourceMatches(pattern: RegExp, timeout = 5000): Promise<void> {
		await this.waitForSourceWith(
			(source, arg) => new RegExp(arg.source, arg.flags).test(source),
			{ source: pattern.source, flags: pattern.flags },
			timeout
		);
	}

	async waitForSourceEquals(expected: string, timeout = 5000): Promise<void> {
		await this.waitForSourceWith((source, arg) => source === arg, expected, timeout);
	}

	async waitForBlockCount(expected: number, timeout = 5000): Promise<void> {
		await this.page.waitForFunction(
			(e) => (window as any).__test?.getBlockCount() === e,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/** The predicate runs in the test process, not the page, so it may read any variable in scope. */
	async waitForSource(predicate: (source: string) => boolean, timeout = 5000): Promise<void> {
		let last: string | undefined;
		const settled = async () => {
			last = await this.page.evaluate(
				() => (window as any).__test?.getSource() as string | undefined
			);
			return last !== undefined && predicate(last);
		};
		try {
			await expect.poll(settled, { timeout, intervals: [16] }).toBe(true);
		} catch (err) {
			// A timeout says what the editor held, so a red on another machine explains itself.
			throw new Error(`waitForSource: the source was ${JSON.stringify(last)}`, { cause: err });
		}
	}

	async waitForSourceWith<T>(
		predicate: (source: string, arg: T) => boolean,
		arg: T,
		timeout = 5000
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

	// Reads SelectionState, not the DOM: `[data-cross-block]` follows that state a render later,
	// so a DOM read can say `false` while the selection is already cross-block.
	async isCrossBlockActive(): Promise<boolean> {
		return this.page.evaluate(() => (window as any).__test.isCrossBlockActive());
	}

	// Narrower than isCrossBlockActive: a rectangle inside one table turns that mode on while
	// both endpoints keep the table's own path, and this still reports false for it.
	async isCrossBlockSelection(): Promise<boolean> {
		return this.page.evaluate(() => (window as any).__test.isCrossBlockSelection());
	}

	// Reads state, not the DOM: the gap's caret element mounts a render after the state is written.
	async getGapCaret(): Promise<GapCaretPosition | null> {
		return this.page.evaluate(() => (window as any).__test.getGapCaret());
	}

	/** Waits for the caret to sit in the given gap; `null` waits for it to leave one. */
	async waitForGapCaret(expected: GapCaretPosition | null, timeout = 5000): Promise<void> {
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

	// The snapshot/restore pair: getSelectionPaths above drops each endpoint's `cellCoordinate`,
	// which a restore has to put back.

	async getSelection(): Promise<EditorSelection | null> {
		return this.page.evaluate(() => (window as any).__test.getSelection());
	}

	async setSelection(selection: EditorSelection): Promise<boolean> {
		return this.page.evaluate((sel) => (window as any).__test.setSelection(sel), selection);
	}
}
