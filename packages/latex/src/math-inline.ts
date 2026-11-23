/**
 * Inline `$…$` math: the claim Pandoc's rule reads, drawn as the editor's renderer draws it, its
 * bytes shown for editing on an arrow or a click. A click on the glyphs lands in the formula how
 * far along the painted run it fell, since KaTeX paints glyphs and not the source.
 */
import {
	inline,
	isUnicodeWhitespace,
	type CaretPoint,
	type WidgetProps
} from '@voithos-labs/aragonite/plugin';
import type { MathRenders } from './math-renders';

// A widget remounts when its bytes change, so its id is what an end-to-end test watches.
let nextMountId = 0;

export function mathInline(renders: MathRenders) {
	return inline<string>({
		name: 'math',
		label: 'Math',
		prefix: '$',
		pair: true,
		sample: ['$x^2$', 'let $a+b$ be', 'one part in $10^5$'],
		match: mathEnd,
		read: (claim) => claim.slice(1, -1),
		widget: {
			delete: 'select-first',
			arrows: 'into',
			click: 'source',
			inner: formulaSpan,
			caret(el, point, source) {
				const span = formulaSpan(source);
				return span && glyphOffset(el, point, span);
			}
		},
		draw(target, props) {
			const el = document.createElement('span');
			el.className = 'math-inline-widget';
			el.dataset.mountId = String(nextMountId++);
			target.append(el);
			let shown: WidgetProps<string> | null = null;
			const paint = (next: WidgetProps<string>) => {
				if (shown?.data === next.data && shown.theme === next.theme) return;
				shown = next;
				el.replaceChildren(renders.render(next.data, false, next.theme).dom);
			};
			paint(props);
			return { update: paint };
		},
		textContent: (formula) => formula
	});
}

const isFlankingSpace = (ch: string | undefined) => ch !== undefined && isUnicodeWhitespace(ch);

/** Pandoc's rule: a claim ends at the next `$`, and a closer with a space before it or a digit
 *  after leaves the opener literal. Added: a span that is only a number (`$5$`) stays prose. */
function mathEnd(text: string, at: number, end: number): number {
	const opener = text[at + 1];
	// `$$` is the display fence, or the empty pair a keystroke just closed.
	if (at + 1 >= end || isFlankingSpace(opener) || opener === '$') return -1;
	const close = text.indexOf('$', at + 2);
	if (close === -1 || close >= end) return -1;
	const after = text[close + 1] ?? '';
	if (isFlankingSpace(text[close - 1]) || (after >= '0' && after <= '9')) return -1;
	return /^\d[\d.,]*$/.test(text.slice(at + 1, close)) ? -1 : close + 1;
}

/** One `$` each side, so an edit stays inside the formula. */
function formulaSpan(source: string): { start: number; end: number } | null {
	return source.length >= 2 ? { start: 1, end: source.length - 1 } : null;
}

/** How far along the painted glyphs a point falls, scaled into the span they draw. */
export function glyphOffset(
	rendered: HTMLElement,
	point: CaretPoint,
	span: { start: number; end: number }
): number | null {
	// `.katex-html` is the half that paints: the MathML copy beside it is clipped to a pixel.
	const glyphs = rendered.querySelector<HTMLElement>('.katex-html');
	const along = glyphs ? point.offsetIn(glyphs) : null;
	const total = glyphs?.textContent?.length ?? 0;
	if (along === null || total === 0) return null;
	return span.start + Math.round((along / total) * (span.end - span.start));
}
