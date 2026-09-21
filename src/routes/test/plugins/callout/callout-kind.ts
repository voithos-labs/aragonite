/**
 * `:::callout` fenced-div callout: a plugin container kind built on the public registration API,
 * dispatched through the shared `:::name` directive support. Dev and e2e only. The title sits in
 * the opener line yet is a real CST child at index 0, so `strip(raw) !== serialize(children)` and
 * the container contract is `'opaque'`. No other plugin takes its directive names: a name two
 * plugins want resolves by install order, which SSR and the browser disagree on.
 */

import {
	activateDirectives,
	chromeChild,
	containerClosure,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerBlockCommand,
	registerChromeLeaf,
	registerDirective,
	isDirectiveRegistered,
	setPluginMetadata,
	type CstNode,
	type ParsedDirective
} from '$lib/plugin';

export const CALLOUT = 'callout';
export const CALLOUT_TITLE = 'callout-title';
/** The second variant, so the kind switch has somewhere to switch to. */
export const ASIDE = 'aside';

interface CalloutMetadata {
	calloutType: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

/**
 * The opener's info string is the plain title (callout's own convention: no `[label]{attrs}`);
 * the fence bytes go into metadata so `rebuildCalloutRaw` can put them back.
 */
function calloutFromDirective(parsed: ParsedDirective): CstNode {
	const title = parsed.fence.info.trim();
	const node: CstNode = {
		kind: declaredPluginKind(CALLOUT),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: [
			chromeChild(declaredPluginKind(CALLOUT_TITLE), title),
			...(parsed.body?.children ?? [])
		],
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

/**
 * Rebuilds the container's raw text when its children change, which the commit path runs. The
 * variant name comes from metadata rather than being fixed here, so a `:::aside` round-trips.
 */
export const rebuildCalloutRaw = createDirectiveRebuild<CalloutMetadata>(
	(meta) => meta?.calloutType ?? CALLOUT
);

export function registerCalloutKind(): void {
	// The shared directive grammar must be live before the callout names resolve.
	// Idempotent, so it re-runs cleanly after a schema reset.
	activateDirectives();

	const callout = declarePluginKind(CALLOUT);
	const calloutTitle = declarePluginKind(CALLOUT_TITLE);

	// A shortcut travelling up from a block inside resolves here and commits through the
	// container's own metadata update; the patch merges over the fence bytes, so the closing
	// `:::` survives.
	const setKind = registerBlockCommand(callout, 'callout.setKind', (ctx) => {
		if (typeof ctx.arg !== 'string') return false;
		ctx.updateMetadata({ calloutType: ctx.arg });
		return true;
	});

	// Idempotent for HMR: the directive registry survives a schema reset, so
	// re-registering would throw without the guard.
	if (!isDirectiveRegistered('container', CALLOUT)) {
		registerDirective('container', CALLOUT, { kind: callout, fromDirective: calloutFromDirective });
		registerDirective('container', ASIDE, { kind: callout, fromDirective: calloutFromDirective });
	}

	registerBlockKind(callout, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// The title child breaks `strip(raw) === serialize(children)`: see the header.
			contract: 'opaque',
			rebuildRaw: rebuildCalloutRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: calloutTitle },
			unwrapRole: {
				firstChildBackspace: 'keep-reserved-chrome',
				middleChildBackspace: 'default-merge'
			}
		},
		conformanceFixture: ':::callout My Title\n\nbody\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildCalloutRaw (directive)',
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: {
				mode: 'implemented',
				via: 'updateMetadata — the type switch commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the title re-emits the callout — a mid-title start reopens it around the collected body, a mid-title end yields a title-only callout'
			},
			simOracle: {
				mode: 'implemented',
				via: 'callout chrome/range-delete e2e under the [invariant:] watcher'
			}
		}),
		// Mod+7 and Mod+8, not Mod+Shift+1 and 2: the browser translates a Shift-held digit by
		// keyboard layout ('1' becomes '!'), so eventToChord would emit `Mod+Shift+!` and never
		// match. 7 and 8 also sit past the Mod+0 to Mod+6 that heading.cycle uses.
		keymap: [
			{ chord: 'Mod+7', command: setKind, arg: CALLOUT },
			{ chord: 'Mod+8', command: setKind, arg: ASIDE }
		]
	});

	// The reserved title child, registered through the public API: no `$lib` component import,
	// and the leaf keeps its kind (contextDependentKind), so typing leaves it a `callout-title`.
	registerChromeLeaf(calloutTitle, { blockClass: 'callout-title' });
}
