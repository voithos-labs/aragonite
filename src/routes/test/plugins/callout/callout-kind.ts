/**
 * `:::callout` fenced-div callout: a plugin container kind built on the public registration API,
 * dispatched through the shared `:::name` directive support. Dev and e2e only. The opener line,
 * title included, is child 0 and the closing line no child, so the container contract is
 * `'opaque'`. No other plugin takes its directive names: a name two plugins want resolves by
 * install order, which SSR and the browser disagree on.
 */

import {
	activateDirectives,
	containerClosure,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	DIRECTIVE_BODY_WRAP,
	withDirectiveName,
	registerBlockKind,
	registerBlockCommand,
	registerDirective,
	setPluginMetadata,
	type BlockView,
	type CstNode,
	type ParsedDirective
} from '#lib/plugin.js';

export const CALLOUT = 'callout';
/** The second variant, so the kind switch has somewhere to switch to. */
export const ASIDE = 'aside';

interface CalloutMetadata {
	calloutType: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

/** The body's blocks; the grammar puts the opener line, which holds the title, in front of them. */
function calloutFromDirective(parsed: ParsedDirective): CstNode {
	const node: CstNode = {
		kind: declaredPluginKind(CALLOUT),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: parsed.body?.children ?? [],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<CalloutMetadata>(node, {
		calloutType: parsed.fence.name,
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline,
		lineEnding: parsed.lineEnding
	});
	return node;
}

/** Rebuilds the container's raw text when its children change, which the commit path runs. */
export const rebuildCalloutRaw = createDirectiveRebuild();

export function registerCalloutKind(view: BlockView): void {
	// The shared directive grammar must be live before the callout names resolve.
	// Idempotent, so it re-runs cleanly after a schema reset.
	activateDirectives();

	const callout = declarePluginKind(CALLOUT);

	// The variant is the opener line's name, so the switch rewrites that line.
	const setKind = registerBlockCommand(callout, 'callout.setKind', (ctx) => {
		if (typeof ctx.arg !== 'string') return false;
		ctx.replaceRaw(withDirectiveName(ctx.node.raw, ctx.arg));
		return true;
	});

	registerDirective('container', CALLOUT, { kind: callout, fromDirective: calloutFromDirective });
	registerDirective('container', ASIDE, { kind: callout, fromDirective: calloutFromDirective });

	registerBlockKind(callout, {
		view,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// The fence lines break `strip(raw) === serialize(children)`: see the header.
			contract: 'opaque',
			rebuildRaw: rebuildCalloutRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP
		},
		conformanceFixture: ':::callout My Title\n\nbody\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildCalloutRaw (directive)',
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: {
				mode: 'implemented',
				via: 'replaceRaw: the type switch rewrites the opener line as one undoable edit'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the opener line re-emits the callout: a mid-title start reopens it around the collected body, a mid-title end yields a title-only callout'
			},
			simOracle: {
				mode: 'implemented',
				via: 'callout chrome/range-delete e2e under the [invariant:] watcher'
			}
		}),
		// Not Mod+Shift+digit: the browser turns a Shift-held digit into its layout's symbol, so
		// the chord would never match. Mod+0 to Mod+6 belong to heading.cycle.
		keymap: [
			{ chord: 'Mod+7', command: setKind, arg: CALLOUT },
			{ chord: 'Mod+8', command: setKind, arg: ASIDE }
		]
	});
}
