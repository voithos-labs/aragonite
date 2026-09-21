import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCoreOracles } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// Math, run in the default gate. It is the first inline widget with real text inside it, since
// KaTeX renders characters, and the first block that shows a render rather than its source, so
// whether its bytes survive, and what mounting and unmounting does, is exactly the quiet
// corruption these checks exist to catch. The ```math fence is a third session: another kind on
// the same component, whose bytes no session had ever moved or deleted across.

const MATH_DOC =
	'Alpha lead paragraph.\n\n' + 'Beta middle paragraph.\n\n' + 'Gamma tail paragraph.\n';

// A mermaid diagram with prose on both sides, so the gestures that focus the whole block have
// an editable neighbour either way. The diagram renders through a dynamic import, so the wait
// for its SVG is generous.
const MERMAID_DOC =
	'Above text\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\ntail text\n';

// A ```math fence with prose on both sides, like the mermaid one: the structural gestures work
// from a neighbour, so both a move and a range delete reach the fence's bytes without ever
// focusing it.
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

		// ── Inline: insert at the end of a prose block, edit it, delete it ───────
		await editor.focusBlockEnd(0);
		await page.keyboard.type(' ');
		await g.insertInlineMath('x^2');
		await checkOracles('inline-inserted');

		await g.editInlineMath('y');
		await checkOracles('inline-edited');

		// Enter the widget with the caret: arrow through it and back out, which must change no
		// bytes, then Backspace into it, type inside the formula and commit by moving the caret
		// out past its end.
		await g.walkThroughInlineMath(0);
		await expect(page.locator('.math-inline-widget')).toHaveCount(1);
		await checkOracles('inline-walk-through');

		await g.backspaceRevealEditInlineMath(0, 'z');
		// The insert landed inside the fence, not as loose text after the widget.
		expect(await editor.bridge.getSource()).toContain('$x^2yz$');
		await checkOracles('inline-reveal-commit');

		// Delete text on either side of the widget, which must survive the edit, then the
		// widget itself.
		await g.deleteAroundInlineMath(0);
		await expect(page.locator('.math-inline-widget')).toHaveCount(1);
		await checkOracles('inline-deleted-around');

		await g.deleteInlineMathWidget(0);
		await checkOracles('inline-deleted');

		// ── Block: turn a new line into math, then edit it through its source ────
		await editor.focusBlockEnd(1);
		await g.pressEnter();
		await g.insertBlockMath('a+b', 1);
		await checkOracles('block-inserted');

		await g.editBlockMath('c', 0);
		await checkOracles('block-edited');

		// ── Undo across the commit and the change of kind ────────────────────────
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
		// The diagram renders through a dynamic import the dev server compiles on first use, so
		// wait for the SVG before driving the focus gestures.
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

		// Move the prose above the fence down past it and back. The fence never takes focus;
		// only its position changes, and its raw text and kind must come back untouched, which
		// the gesture checks halfway through.
		await g.reorderPastMathFence(0, 1);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		await checkOracles('reordered-past');

		// Delete a range covering the whole fence, then undo. The gesture checks that no byte of
		// the fence survived and that the undo restored the document exactly.
		await g.deleteAcrossMathFence(1);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		await checkOracles('deleted-across-undone');
	});
});
