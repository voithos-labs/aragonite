/**
 * `:::note` fenced-div callout: a plugin container kind on the public registration
 * seams, dispatched through the shared `:::name` directive primitive. Dev/e2e only.
 * The title lives in the opener line yet is a real CST child at index 0, so
 * `strip(raw) !== serialize(children)` — hence the `'opaque'` container contract, where
 * `raw` is authoritative and exempt from `checkStaleRaw`'s byte-level guard.
 */

import {
	activateDirectives,
	chromeChild,
	containerClosure,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	registerBlockCommand,
	registerChromeLeaf,
	registerDirective,
	isDirectiveRegistered,
	setPluginMetadata,
	type CstNode,
	type ParsedDirective
} from '$lib/plugin';

export const NOTE = 'note';
export const NOTE_TITLE = 'note-title';

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
		kind: declaredPluginKind(NOTE),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: [
			chromeChild(declaredPluginKind(NOTE_TITLE), title),
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
 * variant name lives in metadata (no hardcoded type), so a `:::warning` round-trips.
 */
export const rebuildCalloutRaw = createDirectiveRebuild<CalloutMetadata>(
	(meta) => meta?.calloutType ?? NOTE
);

export function registerCalloutKind(): void {
	// The shared directive grammar must be live before the callout names resolve.
	// Idempotent, so it re-runs cleanly after a schema reset.
	activateDirectives();

	const note = declarePluginKind(NOTE);
	const noteTitle = declarePluginKind(NOTE_TITLE);

	// A chord bubbling from an inner leaf to the container resolves here and commits
	// through the container's own metadata seam. The partial patch merges over the fence
	// bytes, so colonCount/closer fields survive the rebuild; `arg` arrives as `unknown`.
	const setKind = registerBlockCommand(note, 'callout.setKind', (ctx) => {
		if (typeof ctx.arg !== 'string') return false;
		ctx.updateMetadata({ calloutType: ctx.arg });
		return true;
	});

	// Idempotent for HMR: the directive registry survives a schema reset, so
	// re-registering would throw without the guard.
	if (!isDirectiveRegistered('container', NOTE)) {
		registerDirective('container', NOTE, { kind: note, fromDirective: calloutFromDirective });
		registerDirective('container', 'warning', { kind: note, fromDirective: calloutFromDirective });
	}

	registerBlockKind(note, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// Child-0 chrome breaks `strip(raw) === serialize(children)` — see the header.
			contract: 'opaque',
			rebuildRaw: rebuildCalloutRaw,
			reservedChrome: { kind: noteTitle },
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: ':::note My Title\n\nbody\n\n:::\n',
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
			{ chord: 'Mod+7', command: setKind, arg: 'note' },
			{ chord: 'Mod+8', command: setKind, arg: 'warning' }
		]
	});

	// Reserved-child-0 chrome via the public seam: no `$lib` component import, and the
	// leaf is kind-sticky (contextDependentKind) so typing keeps `note-title`.
	registerChromeLeaf(noteTitle, { blockClass: 'note-title' });
}
