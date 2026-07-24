/**
 * Inline text-directive recognizer for `:name[label]{attrs}`. Registered on the
 * `:` trigger, it runs in the inline scanner's default arm and OWNS the whole
 * span: returning `end` past the `[label]{attrs}` means the scanner's bracket
 * stack (links/images) never competes for the directive's inner `[label]`.
 *
 * Conservative by construction — declines unless the name is immediately
 * followed by `[` or `{`, so `:smile:`, `10:30`, `://`, and a bare `:name` stay
 * literal. Attribute/label meaning is not parsed here (see `grammar.ts`
 * `parseDirectiveAttributes`); recognition only delimits the atomic span.
 */

import type { AnyInlineKind, InlineNode, PluginInlineKind } from '../nodes';
import { createBoundedMemo } from '../../bounded-memo';
import { resolveDirective } from './registry';

const isNameStart = (code: number): boolean =>
	(code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a); // A-Z a-z
const isNameChar = (code: number): boolean =>
	isNameStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d; // + 0-9 -

interface BalancedRuns {
	/** `[` position → index past its matching `]`; absent when the run never closes. */
	label: Map<number, number>;
	/** `{` position → index past its matching `}`; absent when the run never closes. */
	attrs: Map<number, number>;
}

/**
 * Balanced-run matches for one block's raw. A depth scan per consultation runs to
 * the end of the block whenever the run is unbalanced, so a paragraph carrying many
 * `:name[` starts paid one full block scan each — the container opener's
 * closer-index scar, one layer down. Matching is prefix-determined (truncating the
 * block only removes closers), so one stack pass answers every consultation and the
 * caller's `end` filters the result. Bounded rather than weak-keyed because a string
 * cannot key a WeakMap; two entries cover a block's own scan, the only place
 * consecutive consultations share a `raw`.
 */
const balancedRuns = createBoundedMemo<string, BalancedRuns>({ cap: 2 });

function matchBalancedRuns(raw: string): BalancedRuns {
	const label = new Map<number, number>();
	const attrs = new Map<number, number>();
	const labelOpens: number[] = [];
	const attrsOpens: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		switch (raw[i]) {
			case '[':
				labelOpens.push(i);
				break;
			case ']': {
				const open = labelOpens.pop();
				if (open !== undefined) label.set(open, i + 1);
				break;
			}
			case '{':
				attrsOpens.push(i);
				break;
			case '}': {
				const open = attrsOpens.pop();
				if (open !== undefined) attrs.set(open, i + 1);
				break;
			}
		}
	}
	return { label, attrs };
}

/**
 * Index past the matching close of the balanced run opening at `open` (which
 * points at `openCh`) within `[open, end)`, or -1 if it runs to `end`
 * unbalanced. Same-kind nesting counts by depth, so `[a[b]c]` is one run.
 */
function consumeBalanced(raw: string, open: number, end: number, openCh: '[' | '{'): number {
	const runs = balancedRuns(raw, () => matchBalancedRuns(raw));
	const close = (openCh === '[' ? runs.label : runs.attrs).get(open);
	return close !== undefined && close <= end ? close : -1;
}

export function recognizeTextDirective(
	raw: string,
	pos: number,
	end: number,
	kind: PluginInlineKind
): InlineNode | null {
	// `://` is a scheme separator (http://, mailto:), never a directive.
	if (raw[pos + 1] === '/' && raw[pos + 2] === '/') return null;

	// name := [A-Za-z][A-Za-z0-9-]*
	let i = pos + 1;
	if (i >= end || !isNameStart(raw.charCodeAt(i))) return null;
	i++;
	while (i < end && isNameChar(raw.charCodeAt(i))) i++;
	const nameEnd = i;

	// Conservative gate: a bare `:name` (`:smile:`, `10:30`) stays literal unless
	// `[` or `{` follows the name immediately.
	if (i >= end) return null;
	const gate = raw[i];
	if (gate !== '[' && gate !== '{') return null;

	if (gate === '[') {
		const labelEnd = consumeBalanced(raw, i, end, '[');
		if (labelEnd < 0) return null;
		i = labelEnd;
		if (i < end && raw[i] === '{') {
			const attrsEnd = consumeBalanced(raw, i, end, '{');
			if (attrsEnd < 0) return null;
			i = attrsEnd;
		}
	} else {
		const attrsEnd = consumeBalanced(raw, i, end, '{');
		if (attrsEnd < 0) return null;
		i = attrsEnd;
	}

	// Sibling-path parity with the block opener: a registered name resolves to the
	// plugin's own inline kind, an unregistered name keeps the generic `kind`. The
	// name slice + lookup are off the per-keystroke path — reached only past the
	// `[`/`{` gate on a fully balanced span.
	const def = resolveDirective('text', raw.slice(pos + 1, nameEnd));
	return { kind: (def?.kind ?? kind) as AnyInlineKind, start: pos, end: i };
}
