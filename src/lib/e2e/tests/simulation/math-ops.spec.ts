import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Ungated math-ops oracle. Math is the first NONZERO-INTERIOR inline widget (KaTeX renders
// real glyph text nodes) and the first render-primary block, so its byte survival and
// mount/unmount churn are the silent-corruption class the oracle stack exists to catch. The
// ```math fence is a third session: a distinct kind on the same component, whose bytes no
// session had ever moved or deleted across.

const MATH_DOC =
	'Alpha lead paragraph.\n\n' + 'Beta middle paragraph.\n\n' + 'Gamma tail paragraph.\n';

// A mermaid diagram flanked by prose so the whole-block-focus detour has an
// editable neighbour on each side. The diagram renders through the plugin's
// dynamic-import engine, so the SVG wait is generous.
const MERMAID_DOC =
	'Above text\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\ntail text\n';

// A ```math fence flanked by prose, mirroring the mermaid shape: the structural
// gestures drive the fence from a neighbour on either side, so both a sibling
// reorder and a range delete reach its bytes without ever focusing it.
const MATH_FENCE_DOC = 'Above the fence\n\n```math\nx^2\n```\n\nBelow the fence\n';

test.describe('math-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('insert / reveal-edit-commit / delete of inline + block math stays corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(MATH_DOC);
		await editor.waitForRenderFlush();

		const ctx = await makeSimContext(page, editor, 'math-ops', { errors });
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

		const ctx = await makeSimContext(page, editor, 'mermaid-focus', { errors });
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

	test('a ```math fence survives a sibling reorder and a range delete that spans it', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(MATH_FENCE_DOC);
		await editor.waitForRenderFlush();
		await expect(page.locator('.math-block-render')).toHaveCount(1);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');

		const ctx = await makeSimContext(page, editor, 'math-fence', { errors });
		const g = new Gestures(ctx, makeRng(1));

		const checkOracles = (label: string) => assertCoreOracles(ctx, label);
		await checkOracles('loaded');

		// Move the prose above the fence down past it and back. The fence never takes
		// focus; only its position in the sibling array changes, and its raw + kind must
		// come back untouched (the gesture asserts both at the intermediate position).
		await g.reorderPastMathFence(0, 1);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		await checkOracles('reordered-past');

		// Delete a range that covers the fence whole, then undo. The gesture asserts no
		// fence byte survived the collapse and the undo restored the document exactly.
		await g.deleteAcrossMathFence(1);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		await checkOracles('deleted-across-undone');
	});
});
