import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { Gestures } from '../../simulation/gestures';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { type SimContext, assertCoreOracles } from '../../simulation/invariants';

// Ungated math-ops oracle for the LaTeX extension. Math is the first nonzero-
// interior inline widget (KaTeX renders real glyph text nodes) and the first
// render-primary block, so its byte survival and mount/unmount churn are exactly
// the silent-corruption class the simulation's oracle stack (structured error +
// `[invariant:…]` watcher, live-CST round-trip, nested-state audit) exists to
// catch — and until this profile no gesture had ever driven a math widget under
// a state-accumulating watcher. Mirrors plugin-ops.spec.ts: a loaded document on
// the plugins route, the math gesture vocabulary, all oracles re-checked after
// every move, fixed rng for determinism.

const MATH_DOC =
	'Alpha lead paragraph.\n\n' + 'Beta middle paragraph.\n\n' + 'Gamma tail paragraph.\n';

// A mermaid diagram flanked by prose so the whole-block-focus detour has an
// editable neighbour on each side. The diagram renders through the plugin's
// dynamic-import engine, so the SVG wait is generous.
const MERMAID_DOC =
	'Above text\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\ntail text\n';

class MathSimPage extends EditorPage {
	async gotoPlugins(): Promise<void> {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

test.describe('math-ops simulation', () => {
	let editor: MathSimPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathSimPage(page);
		await editor.gotoPlugins();
	});

	test('insert / reveal-edit-commit / delete of inline + block math stays corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(MATH_DOC);
		await editor.waitForRenderFlush();

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'math-ops' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// ── Inline: insert at the end of a prose block, edit, delete ────────────
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.insertInlineMath('x^2');
		await checkOracles('inline-inserted');

		await g.editInlineMath('y');
		await checkOracles('inline-edited');

		// Caret-entry reveal: arrow-walk through the widget and back out (byte-identical
		// entry+fold), then Backspace-enter, insert inside the formula, and commit by
		// escaping the trailing edge (the reveal commit-on-escape path).
		await g.walkThroughInlineMath(0);
		await expect(page.locator('.math-inline-widget')).toHaveCount(1);
		await checkOracles('inline-walk-through');

		await g.backspaceRevealEditInlineMath(0, 'z');
		// The insert landed inside the fence, not as loose text after the widget.
		expect(await editor.bridge.getSource()).toContain('$yx^2z$');
		await checkOracles('inline-reveal-commit');

		// Delete text flanking the surviving widget (byte survival under an adjacent
		// edit), then the widget itself.
		await g.deleteAroundInlineMath(0);
		await expect(page.locator('.math-inline-widget')).toHaveCount(1);
		await checkOracles('inline-deleted-around');

		await g.deleteInlineMathWidget(0);
		await checkOracles('inline-deleted');

		// ── Block: promote a fresh line, edit through the source reveal ─────────
		await editor.focusBlockEnd(1);
		await g.pressEnter();
		await g.insertBlockMath('a+b', 1);
		await checkOracles('block-inserted');

		await g.editBlockMath('c', 0);
		await checkOracles('block-edited');

		// ── Undo across the reveal→commit and the promotion ─────────────────────
		await g.pause();
		await g.undo();
		await checkOracles('block-edit-undo');

		await g.undo();
		await checkOracles('block-insert-undo');
	});

	test('mermaid whole-block focus, two-step delete, and Enter-below stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(MERMAID_DOC);
		await editor.waitForRenderFlush();
		// The diagram renders through a dynamic import the dev server transforms on
		// first hit; wait for the SVG before driving the focus gestures.
		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });

		const tracker = new ExpectationTracker(await editor.bridge.getSource());
		const ctx: SimContext = { page, editor, tracker, errors, label: 'mermaid-focus' };
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// Diagram sits at [1]; the prose below it is [2].
		await g.arrowFocusMermaid(2);
		await checkOracles('arrow-focus');

		await g.enterBelowUndoMermaid();
		await checkOracles('enter-below-undo');

		await g.backspaceTwoStepDeleteUndoMermaid(2);
		await checkOracles('two-step-delete-undo');
	});
});
