// The parts the range-edit checks read Markdown with: every bundled plugin that adds syntax,
// installed inside each test (the setup resets the platform between tests), the editor's reading
// over them, and the host the core reads through, with what a block's text shows on screen.

import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { constructContentRange, inlineDescendants, readInline } from '#lib/core/inline/index.js';
import { visibleText } from '#lib/core/inline/link-source-bytes.js';
import { getInlineConstructPolicy } from '#lib/schema/inline-construct-policy.js';
import { hidesDelimitersAtCaret } from '#lib/presentation-mode.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import type { Reading } from '#lib/schema/reading.js';
import { kitReading } from '#lib/testing/kit-reading.js';
import { rangeHost, type Mode, type PasteHost, type RangeHost } from '#lib/range-edit/host.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

const PLUGINS = [...SYNTAX_PLUGINS, mermaidPlugin()];

/** The reading an editor with every bundled syntax plugin reads with; call it inside a test. */
export function testReading(): Reading {
	installPlugins(PLUGINS);
	return kitReading();
}

/** `host` as a paste reads through it in an editor that registered no paste transform. */
export const noTransforms = (host: RangeHost): PasteHost => ({
	...host,
	transformPaste: (text) => text
});

/** The host, and what text shows on screen in a mode, which law 11 reads. */
export interface CheckHost extends PasteHost {
	shows(text: string, mode: Mode): string;
	/** A live split at `offset` of a block's `text`, by its constructs' policy rows: `whole` moves
	 *  the cut to an edge; `literal` has no sound rewrite (a plain kind, a code span beside a backtick). */
	liveCut(text: string, offset: number): 'whole' | 'literal' | null;
	/** Whether a construct of a block's `text` holds `offset` between its first and last byte. */
	heldAt(text: string, offset: number): boolean;
	/** The kinds of the format runs a cut at `offset` of a block's `text` goes through. */
	runsAt(text: string, offset: number): string[];
}

export function checkHost(reading: Reading = testReading()): CheckHost {
	const shows = (text: string, mode: Mode) =>
		visibleText(text, {
			...reading,
			mode: () => mode,
			hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(mode)
		});
	const holding = (text: string, offset: number) =>
		[
			...inlineDescendants(readInline(text, 0, text.length, reading.resolver, reading.grammar))
		].filter((node) => node.start < offset && offset < node.end);
	const heldAt = (text: string, offset: number) =>
		holding(text, offset).some((node) => node.kind !== 'text');
	const runsAt = (text: string, offset: number) =>
		holding(text, offset)
			.filter((node) => {
				const content = constructContentRange(node);
				return !!content && content.start < offset && offset < content.end;
			})
			.map((node) => node.kind);
	const liveCut = (text: string, offset: number) => {
		let cut: 'whole' | 'literal' | null = null;
		for (const node of holding(text, offset)) {
			const split = getInlineConstructPolicy(node.kind)?.splitBehavior;
			const besideTick = /`/.test(text.slice(offset - 1, offset + 1));
			if (split === 'whole') return 'whole';
			if (split === 'plain' && constructContentRange(node)) cut = 'literal';
			if (node.kind === 'inlineCode' && besideTick) cut = 'literal';
		}
		return cut;
	};
	return { ...noTransforms(rangeHost(reading)), shows, liveCut, heldAt, runsAt };
}
