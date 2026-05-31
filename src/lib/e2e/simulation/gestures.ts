import type { Rng } from './rng';
import { type SimContext, assertFocusBlock, settleTypedSource } from './invariants';
import {
	applyBold,
	applyItalic,
	copySelection,
	pasteHere,
	selectAndDelete
} from './gestures/selection';
import {
	continueQuote,
	indent,
	outdent,
	softEnter,
	startQuote,
	toggleTask
} from './gestures/structure';
import { insertImage, resizeImage } from './gestures/image';

/**
 * The human-gesture vocabulary atop EditorPage. Each gesture performs a real
 * keyboard/mouse action, then either predicts (printable typing) or resyncs
 * the tracker (auto-behavior), and settles on an observable state predicate —
 * never a bare sleep. Phase 1 ships the subset the smoke needs; later batches
 * add new methods against this frozen surface without changing signatures.
 */
export interface GestureOpts {
	typoRate?: number;
	onCheckpoint?: (label: string, gesture: string) => Promise<void>;
}

export class Gestures {
	private readonly typoRate: number;
	private readonly onCheckpoint?: (label: string, gesture: string) => Promise<void>;

	constructor(
		private readonly ctx: SimContext,
		private readonly rng: Rng,
		opts: GestureOpts = {}
	) {
		this.typoRate = opts.typoRate ?? 0;
		this.onCheckpoint = opts.onCheckpoint;
	}

	/**
	 * Annotate a build boundary so the recorder can capture mid-build state. The
	 * fixture marks structural units as it authors them; the orchestrator decides
	 * whether anything is listening (only the capture run wires a hook). A no-op
	 * when unwired, so it mutates nothing and stays out of the deterministic spine.
	 */
	async checkpoint(label: string, gesture: string): Promise<void> {
		await this.onCheckpoint?.(label, gesture);
	}

	// ── Typing ────────────────────────────────────────────────────────────────

	async typeText(text: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		for (const ch of text) {
			if (this.typoRate > 0 && isLetter(ch) && this.rng.chance(this.typoRate)) {
				await this.injectCancellingTypo(ch);
			}
			await editor.typeSlowly(ch);
			await settleTypedSource(this.ctx, tracker.appendChar(ch));
		}
	}

	// ── Navigation / repositioning ──────────────────────────────────────────────

	/**
	 * Real pointer click into a top-level block to reposition the caret, then
	 * assert the focus block landed where intended (CRITICAL-2: a wrong-block
	 * landing must never be silently recorded as truth). The caret offset is
	 * accepted for the frozen signature but the click lands at the block's
	 * natural hit point — the block path is the load-bearing assertion; the
	 * offset resyncs to whatever the click produced. Offset-precise clicks into
	 * nested blocks arrive with a Phase-2 gesture built on a public point API.
	 */
	async clickToReposition(targetBlockPath: number[], _offset: number): Promise<void> {
		const { editor, tracker } = this.ctx;
		await editor.clickBlock(targetBlockPath[0]);
		await editor.waitForRenderFlush();
		await assertFocusBlock(this.ctx, targetBlockPath);
		tracker.resync(await editor.bridge.getSource());
	}

	// ── Structure ───────────────────────────────────────────────────────────────

	/** Enter splits a block; the transient empty block is auto-behavior, so resync. */
	async pressEnter(): Promise<void> {
		const { page, editor, tracker } = this.ctx;
		const hostsBefore = await page.evaluate(() => document.querySelectorAll('.block-host').length);
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(hostsBefore + 1);
		tracker.resync(await editor.bridge.getSource());
	}

	// ── Delegators ──────────────────────────────────────────────────────────────
	// Thin facade over the per-concern free functions in gestures/. They take the
	// SimContext explicitly so they stay unit-addressable and the frozen class
	// surface grows without bloating this file.

	selectAndDelete(count: number): Promise<void> {
		return selectAndDelete(this.ctx, count);
	}

	copySelection(): Promise<void> {
		return copySelection(this.ctx);
	}

	pasteHere(): Promise<void> {
		return pasteHere(this.ctx);
	}

	applyBold(): Promise<void> {
		return applyBold(this.ctx);
	}

	applyItalic(): Promise<void> {
		return applyItalic(this.ctx);
	}

	softEnter(): Promise<void> {
		return softEnter(this.ctx);
	}

	indent(): Promise<void> {
		return indent(this.ctx);
	}

	outdent(): Promise<void> {
		return outdent(this.ctx);
	}

	startQuote(text: string): Promise<void> {
		return startQuote(this.ctx, text);
	}

	continueQuote(text: string): Promise<void> {
		return continueQuote(this.ctx, text);
	}

	toggleTask(listItemPath: number[]): Promise<void> {
		return toggleTask(this.ctx, listItemPath);
	}

	insertImage(alt: string, url: string): Promise<void> {
		return insertImage(this.ctx, alt, url);
	}

	resizeImage(direction: 'left' | 'right', steps: number): Promise<void> {
		return resizeImage(this.ctx, direction, steps);
	}

	// ── History ───────────────────────────────────────────────────────────────

	async undo(): Promise<void> {
		await this.ctx.editor.undo();
		this.ctx.tracker.resync(await this.ctx.editor.bridge.getSource());
	}

	async redo(): Promise<void> {
		await this.ctx.editor.redo();
		this.ctx.tracker.resync(await this.ctx.editor.bridge.getSource());
	}

	// ── Internal ────────────────────────────────────────────────────────────────

	/** Type a wrong neighbor key, settle, Backspace it out, settle — nets to identity. */
	private async injectCancellingTypo(intended: string): Promise<void> {
		const { editor, tracker } = this.ctx;
		const wrong = neighborKey(intended, this.rng);
		await editor.typeSlowly(wrong);
		await settleTypedSource(this.ctx, tracker.appendChar(wrong));
		await editor.page.keyboard.press('Backspace');
		await settleTypedSource(this.ctx, tracker.backspaceAtEnd());
	}
}

const KEY_NEIGHBORS: Record<string, string> = {
	a: 's',
	e: 'r',
	i: 'o',
	o: 'i',
	n: 'm',
	t: 'y',
	s: 'a',
	r: 'e'
};

function neighborKey(ch: string, rng: Rng): string {
	const lower = ch.toLowerCase();
	const neighbor = KEY_NEIGHBORS[lower];
	if (neighbor) return ch === lower ? neighbor : neighbor.toUpperCase();
	return rng.pick(['x', 'z', 'q'] as const);
}

function isLetter(ch: string): boolean {
	return /[a-z]/i.test(ch);
}
