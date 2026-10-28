// A `:::` container's title row is its opener line, which the grammar builds, so the registration
// checks read the row it has, not the one it declares.
// Miss-analysis: the checks read only a declared `reservedChrome`, and no row registered a `:::`
// container through them once its row stopped being declared.
import { describe, it, expect } from 'vitest';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import {
	activateDirectives,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	DIRECTIVE_BODY_WRAP,
	getPluginMetadata,
	registerBlockKind,
	registerChromeLeaf,
	registerDirective,
	setPluginMetadata,
	type AnyBlockKind,
	type CstNode,
	type ParsedDirective,
	type PluginBlockKind
} from '#lib/plugin.js';
import { parse } from '#lib/core/parser.js';
import { checkClosureCoherence } from '#lib/invariants/registry.js';
import { getBlockKindDescriptor, type ReservedChrome } from '#lib/schema/block-kind-descriptor.js';
import { isCollapsedContainer } from '#lib/schema/reserved-chrome.js';
import {
	closureCoherenceEntry,
	flushPendingRegistrationChecks
} from '#lib/schema/registration-checks.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { testView } from '#lib/test/harness/test-view.js';

function registerBox(
	name: string,
	over: { reservedChrome?: ReservedChrome; clipboardInherits?: boolean } = {}
): PluginBlockKind {
	activateDirectives();
	const kind = declarePluginKind(name);
	registerDirective('container', name, {
		kind,
		fromDirective: (parsed: ParsedDirective): CstNode => {
			const node: CstNode = {
				kind,
				leadingTrivia: parsed.leadingTrivia,
				raw: parsed.raw,
				innerPrefix: parsed.body?.prefix ?? '',
				children: parsed.body?.children ?? [],
				innerSuffix: parsed.body?.suffix ?? ''
			};
			setPluginMetadata(node, {
				closerColonCount: parsed.closerColonCount,
				closerNewline: parsed.closerNewline
			});
			return node;
		}
	});
	registerBlockKind(kind, {
		view: testView(),
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: createDirectiveRebuild(),
			bodyWrap: DIRECTIVE_BODY_WRAP,
			...(over.reservedChrome ? { reservedChrome: over.reservedChrome } : {})
		},
		closure: over.clipboardInherits
			? { ...testClosure, clipboard: { mode: 'inherit-default' } }
			: testClosure
	});
	return kind;
}

function violationsAt(tag: string): InvariantViolation[] {
	const found: InvariantViolation[] = [];
	flushPendingRegistrationChecks((at, check) => {
		const violation = check();
		if (at === tag && violation) found.push(violation);
	});
	return found;
}

describe('a `:::` container registers against the opener line it holds', () => {
	it('names what a copy of the opener line produces', () => {
		const kind = registerBox('rumor', { clipboardInherits: true });
		const entry = closureCoherenceEntry(kind, getBlockKindDescriptor(kind));
		expect(checkClosureCoherence([entry])?.detail).toMatchObject({ kind, column: 'clipboard' });
	});

	it('names no title row kind of its own', () => {
		const title = declarePluginKind('hearsay-title');
		registerChromeLeaf(title);
		registerBox('hearsay', { reservedChrome: { kind: title } });
		expect(violationsAt('reserved-chrome-coherence')[0]?.detail).toMatchObject({
			kind: 'hearsay',
			chromeKind: 'hearsay-title'
		});
	});

	it('folds from a collapse check declared on its opener line', () => {
		activateDirectives();
		const kind = registerBox('gossip', {
			reservedChrome: {
				kind: declaredPluginKind('directiveOpenerLine') as AnyBlockKind,
				isCollapsed: (node) => !getPluginMetadata<{ open?: boolean }>(node)?.open
			}
		});
		expect(violationsAt('reserved-chrome-coherence')).toEqual([]);
		const node = parse(':::gossip Heard it\n\nbody\n\n:::\n').children[0];
		expect(node.kind).toBe(kind);
		expect(isCollapsedContainer(node)).toBe(true);
	});
});
