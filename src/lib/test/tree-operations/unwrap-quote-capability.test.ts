import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { unwrapFirstChildFromQuote } from '$lib/tree-operations';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

// unwrapFirstChildFromQuote (Rule U2) names no plugin kind: it lifts only when the
// container DECLARES `unwrapRole.quoteShaped`. A future quote-shaped kind opts in by
// declaration, not by a core edit to a hardcoded kind list.

afterEach(() => __resetSchemaRegistriesForTests());

// Metadata cleared so the lift exercises the alert-like default, with no quoteDepth.
function twoChildContainer(kind: AnyBlockKind): CstNode {
	const bq = parse('> first\n>\n> second\n').children[0];
	return { ...bq, kind, metadata: undefined } as CstNode;
}

function registerQuoteKind(name: string, quoteShaped: boolean): AnyBlockKind {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: {
			contract: 'strip',
			rebuildRaw: () => {},
			unwrapRole: {
				firstChildBackspace: 'lift-first-child',
				middleChildBackspace: 'default-merge',
				...(quoteShaped ? { quoteShaped: true } : {})
			}
		}
	});
	return kind;
}

describe('unwrapFirstChildFromQuote dispatches on the quoteShaped capability, not a kind name', () => {
	it('lifts the first child for a scratch kind that declares unwrapRole.quoteShaped', () => {
		const kind = registerQuoteKind('spec-quote-shaped', true);
		const result = unwrapFirstChildFromQuote(twoChildContainer(kind));
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect(result[1].kind).toBe('blockquote');
	});

	it('no-ops for a scratch kind that shares lift-first-child but omits quoteShaped', () => {
		const kind = registerQuoteKind('spec-chrome-container', false);
		expect(unwrapFirstChildFromQuote(twoChildContainer(kind))).toEqual([]);
	});
});
