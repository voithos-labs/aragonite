// parrot-plugin.ts
import {
	caretOffsetAtPoint,
	declarePluginKind,
	defineBlockView,
	definePlugin,
	registerBlockKind,
	simpleLeafClosure,
	trimWhitespace,
	type BlockViewState,
	type CaretTarget,
	type EditorPlugin
} from '@voithos-labs/aragonite/plugin';
import { PARROT_FRAMES } from './parrot-frames';
import './parrot.css';

export const PARROT = 'parrot';

// One strip the CSS scrolls a frame at a time. The closing newline matters: a `pre` drops a
// trailing blank line, and a strip a row short steps a fraction off every frame.
const REEL = PARROT_FRAMES.join('\n') + '\n';
// The clip window's height, which is why every frame has to be the same number of rows.
const FRAME_ROWS = PARROT_FRAMES[0].split('\n').length;

/** The caption is the rest of the marker line, trimmed, and `start` is where it sits in the
 *  source, so a press in the caption can be mapped back to a byte. */
function parrotCaption(raw: string): { text: string; start: number } {
	const rest = raw.slice('%%parrot'.length);
	const text = trimWhitespace(rest);
	return { text, start: '%%parrot'.length + rest.indexOf(text) };
}

const parrotView = defineBlockView({
	surface: 'render-primary',
	singleLine: true,
	mount(target, ctx) {
		target.className = 'parrot-block';
		target.style.setProperty('--parrot-rows', String(FRAME_ROWS));
		target.style.setProperty('--parrot-frames', String(PARROT_FRAMES.length));

		const bird = document.createElement('div');
		bird.className = 'parrot';
		bird.setAttribute('aria-hidden', 'true');
		const reel = document.createElement('pre');
		reel.className = 'parrot-reel';
		reel.textContent = REEL;
		bird.append(reel);

		const caption = document.createElement('div');
		caption.className = 'parrot-caption';
		caption.setAttribute('role', 'button');
		caption.setAttribute('aria-label', 'Party parrot caption (click to edit)');
		caption.tabIndex = -1;
		const source = document.createElement('div');
		source.className = 'parrot-source';
		target.append(bird, caption);
		// The whole folded block takes the click, bird included.
		ctx.leaf.attachRendered(target);

		const draw = ({ node, revealed }: BlockViewState) => {
			const { text, start } = parrotCaption(node.raw);
			caption.textContent = text;
			caption.dataset.captionStart = String(start);
			// Only on a flip: a fresh source element mid-edit would lose the typing in it.
			const shown = revealed ? source : caption;
			if (shown.isConnected) return;
			(revealed ? caption : source).replaceWith(shown);
			ctx.leaf.attach(revealed ? source : null);
		};
		draw(ctx.state());
		return { update: draw };
	}
});

/** Where a click in the block puts the caret. The caption says where it starts in the source,
 *  so an offset in it sits that far along; the shown source is the source itself. */
function parrotCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): CaretTarget | null {
	const source = blockEl.querySelector<HTMLElement>('.parrot-source');
	const view = source ?? blockEl.querySelector<HTMLElement>('.parrot-caption');
	if (!view) return null;
	const offset = caretOffsetAtPoint(view, clientX, clientY) ?? 0;
	return { path: [], offset: source ? offset : offset + Number(view.dataset.captionStart) };
}

function registerParrotBlock(): void {
	const parrot = declarePluginKind(PARROT);

	registerBlockKind(parrot, {
		view: parrotView,
		opener: {
			priority: 25,
			interruptsParagraph: (text) => text.startsWith('%%parrot'),
			tryOpen(ctx) {
				if (!ctx.line.text.startsWith('%%parrot')) return null;
				const node = { kind: parrot, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
				return { node, consumed: 1 };
			}
		},
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '%%parrot party responsibly\n',
		caretTargetAtPoint: parrotCaretAtPoint,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'the render-primary surface reveals on focus' },
			searchPaint: { mode: 'implemented', via: 'source raw scanned, matches painted as marks' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});
}

export function parrotPlugin(): EditorPlugin {
	return definePlugin({ name: 'parrot', setup: registerParrotBlock });
}
