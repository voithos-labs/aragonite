/**
 * `:::callout` fenced-div callout: a plugin container kind on the public registration seams,
 * dispatched through the shared `:::name` directive primitive. Dev/e2e only. The title lives
 * in the opener line yet is a real CST child at index 0, so `strip(raw) !== serialize(children)`
 * and the container contract is `'opaque'`. Its directive names are claimed by no other
 * plugin: a contended name resolves by install order, which SSR and the browser disagree on.
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
 * The opener info is the bare title (callout's opaque convention — no `[label]{attrs}`);
 * the fence bytes go into metadata so `rebuildCalloutRaw` can reconstruct them.
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
 * The container-rebuild inverse the commit primitive runs when children mutate. The
 * variant name lives in metadata (no hardcoded type), so a `:::aside` round-trips.
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

	// A chord bubbling from an inner leaf resolves here and commits through the container's own
	// metadata seam; the partial patch merges over the fence bytes, so the closer survives.
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
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// Child-0 chrome breaks `strip(raw) === serialize(children)` — see the header.
			contract: 'opaque',
			rebuildRaw: rebuildCalloutRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: calloutTitle },
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
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
		// Mod+7/Mod+8, NOT Mod+Shift+1/2: a Shift-held digit's key token is
		// layout-translated by the browser ('1'→'!'), so eventToChord would emit
		// `Mod+Shift+!` and never match. 7/8 also sit past the Mod+0–6 heading.cycle range.
		keymap: [
			{ chord: 'Mod+7', command: setKind, arg: CALLOUT },
			{ chord: 'Mod+8', command: setKind, arg: ASIDE }
		]
	});

	// Reserved-child-0 chrome via the public seam: no `$lib` component import, and the
	// leaf is kind-sticky (contextDependentKind) so typing keeps `callout-title`.
	registerChromeLeaf(calloutTitle, { blockClass: 'callout-title' });
}
