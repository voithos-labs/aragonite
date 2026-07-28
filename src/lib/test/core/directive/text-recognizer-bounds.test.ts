// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { recognizeTextDirective } from '$lib/core/directive/text-recognizer';
import { declaredPluginInlineKind } from '$lib/schema/plugin-kind';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_TEXT } from '$lib/core/directive/kinds';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../harness/scan-growth';

activateDirectiveGrammar(); // declares directiveText + the ':' recognizer, before any parse

const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
const scan = (raw: string) => parseInline(raw, 0, raw.length);

// An unbalanced `:name[` searched to the end of the block before declining, so a
// paragraph carrying many of them paid one full block scan per `:`. Bracket runs are
// matched once per block instead — the container opener's closer-index shape, one
// layer down.
describe('text directive decline bounds', () => {
	it('an unbalanced-label flood scans within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, ':a[', [32, 128]);
		expect(ratio, `32KB=${times[0].toFixed(1)}ms 128KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// Depth-counted nesting is what the bound has to preserve: a later `[` that
	// balances must not be mistaken for the outer run's close.
	it('keeps depth-counted nesting across a declining run', () => {
		const raw = ':a['.repeat(200) + ':x[p[q]r] tail';
		const claimed = scan(raw).filter((n) => n.kind === DIRECTIVE_TEXT);
		expect(claimed).toHaveLength(1);
		expect(raw.slice(claimed[0].start, claimed[0].end)).toBe(':x[p[q]r]');
	});

	// The scan range, not the block string, bounds a claim — a `]` past `end` must
	// leave the run unbalanced.
	it('ignores a closing bracket beyond the scan range', () => {
		expect(recognizeTextDirective(':x[a]', 0, 4, kind)).toBeNull();
		expect(recognizeTextDirective(':x[a]', 0, 5, kind)).toEqual({ kind, start: 0, end: 5 });
	});
});
