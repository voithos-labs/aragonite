/**
 * A maker's drawing of a block with text: its type's `draw`, or the editor's element for the text
 * alone where it has none. The shown text is painted as the editor's markers (a fenced block's fence
 * lines, a line block's marker) around the type's own painting of the text inside them, so every
 * block type's markers dim and hide the way the built-in blocks' do.
 */
import type { LineEnding } from '../../core/lines';
import type { Block } from '../../schema/doc-view';
import type { CodePainter } from '../../schema/code-highlighter';
import type { Drawing, TextDrawContext } from '../../schema/drawing';
import { editOf, leafDrawing, type LeafDraw } from '../../schema/block-shapes';
import type { BlockType } from '../../schema/plugin-unit';

type CaretText = { text: string; caret: number };

/** How a block type's shape frames its shown text: the editor's markers around `paintText`'s
 *  painting of the text inside them, and the shape the text keeps while it's edited. */
export interface SourceFrame {
	paint(text: string, paintText: (inner: string) => Node): DocumentFragment;
	reshape?(text: string, caret: number, lineEnding: LineEnding): CaretText | null;
}

export function framedDrawing(
	spec: LeafDraw<unknown>,
	type: () => BlockType<unknown>,
	singleLine: boolean,
	frame: SourceFrame
): Drawing {
	const drawing = leafDrawing(spec, type, singleLine) ?? textOnly(spec, type, singleLine);
	if (spec.edit === 'box') return drawing;
	const own = spec.renderSource;
	const paintText =
		(paint: CodePainter) =>
		(inner: string): Node =>
			own ? own(inner, paint) : document.createTextNode(inner);
	return {
		...drawing,
		renderSource: (text, paint) => frame.paint(text, paintText(paint)),
		reshapeSource: reshapes(spec.reshapeSource, frame.reshape),
		paintsText: own !== undefined
	};
}

// The type's own reshape first, then the frame's, whose shape every write of the block keeps.
function reshapes(
	own: SourceFrame['reshape'],
	frame: SourceFrame['reshape']
): SourceFrame['reshape'] {
	if (!own || !frame) return own ?? frame;
	return (text, caret, lineEnding) => {
		const first = own(text, caret, lineEnding);
		return frame(first?.text ?? text, first?.caret ?? caret, lineEnding) ?? first;
	};
}

// With no `draw`, the editor's element for the text is the whole drawing, and a block that opens
// its text shows its body until then.
function textOnly(
	spec: LeafDraw<unknown>,
	type: () => BlockType<unknown>,
	singleLine: boolean
): Drawing {
	const edit = editOf(spec) === 'source' ? 'source' : 'text';
	const draw = (block: Block<unknown>, ctx: TextDrawContext) => {
		if (edit === 'text') return { dom: ctx.source };
		const dom = document.createElement('div');
		const shown = document.createElement('div');
		const show = (next: Block<unknown>, now: TextDrawContext) => {
			shown.textContent = next.body;
			shown.hidden = now.focused;
		};
		show(block, ctx);
		dom.append(shown, ctx.source);
		return { dom, caret: shown, update: show };
	};
	return { type, edit, singleLine, draw: draw as Drawing['draw'] };
}
