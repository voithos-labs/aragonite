/**
 * `:::note` fenced-div callout — a plugin container kind built on the public
 * registration seams, dispatched through the shared `:::name` directive
 * primitive rather than an opener of its own. Dev/e2e harness only.
 *
 * `registerCalloutKind` registers `note`/`warning` as directive names on the
 * shared `:::` opener; `:::note`/`:::warning` resolve here, any other name falls
 * through to the generic directive container. The title lives in the opener line
 * (`:::note My Title`) yet is a real CST child at index 0, so
 * `strip(raw) !== serialize(children)` — hence the `'opaque'` container contract:
 * `raw` is authoritative (not a strip-decomposition), exempt from `checkStaleRaw`'s
 * byte-level guard. `rebuildCalloutRaw` re-emits the title into the opener line via
 * `serializeDirective`.
 */

import {
	activateDirectives,
	chromeChild,
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
 * Build a callout node from a resolved `:::note`/`:::warning` fence. The opener
 * info is the bare title (callout's opaque convention — no `[label]{attrs}`); the
 * fence bytes go into metadata so `rebuildCalloutRaw` can reconstruct them.
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
 * Reconstruct `raw` from children after a structural edit — the container-rebuild
 * inverse the commit primitive runs when the callout's children mutate, and the
 * `setKind` command's metadata commit. The variant name lives in metadata (no
 * hardcoded type), so a `:::warning` survives the round-trip.
 */
export const rebuildCalloutRaw = createDirectiveRebuild<CalloutMetadata>(
	(meta) => meta?.calloutType ?? NOTE
);

export function registerCalloutKind(): void {
	// The shared directive grammar + generic render must be live before the callout
	// names resolve. Idempotent, so it re-runs cleanly after a schema reset — the
	// plugin unit owns once-per-process, so this setup never guards against re-entry.
	activateDirectives();

	const note = declarePluginKind(NOTE);
	const noteTitle = declarePluginKind(NOTE_TITLE);

	// A minted block-command on the note kind: a chord that bubbles from an inner
	// leaf to the container resolves this handler, which commits the new callout
	// type through the container's own metadata seam (→ rebuildCalloutRaw → one
	// metadataUpdate). The partial `{ calloutType }` patch merges over the fence
	// bytes, so colonCount/closer fields survive the rebuild. `arg` arrives as
	// `unknown` off the descriptor binding — the handler type-guards it and
	// declines an out-of-shape value.
	const setKind = registerBlockCommand(note, 'callout.setKind', (ctx) => {
		if (typeof ctx.arg !== 'string') return false;
		ctx.updateMetadata({ calloutType: ctx.arg });
		return true;
	});

	// note/warning both map to the note kind; other names fall through to the
	// generic directive container. Idempotent for HMR — the directive registry
	// survives a schema reset, so re-registering would throw without the guard.
	if (!isDirectiveRegistered('container', NOTE)) {
		registerDirective('container', NOTE, { kind: note, fromDirective: calloutFromDirective });
		registerDirective('container', 'warning', { kind: note, fromDirective: calloutFromDirective });
	}

	registerBlockKind(note, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// Child-0 chrome puts the title in the opener line, breaking
			// `strip(raw) === serialize(children)`. `'opaque'` marks raw authoritative
			// and exempts the container from checkStaleRaw's byte-check.
			contract: 'opaque',
			rebuildRaw: rebuildCalloutRaw,
			reservedChrome: { kind: noteTitle },
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: ':::note My Title\n\nbody\n\n:::\n',
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'container contract=opaque — rebuildCalloutRaw (directive)'
			},
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			selectionPaint: { mode: 'implemented', via: 'body child blocks paint; container cover' },
			searchPaint: {
				mode: 'implemented',
				via: 'children are real blocks — search descends and paints'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: {
				mode: 'implemented',
				via: 'updateMetadata — the type switch commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a copy starting mid-title into the body drops the container wrapper (issues.md)'
			},
			simOracle: {
				mode: 'implemented',
				via: 'callout chrome/range-delete e2e under the [invariant:] watcher'
			}
		},
		// Mod+7/Mod+8, NOT Mod+Shift+1/2: a Shift-held digit's key token is
		// layout-translated by the browser ('1'→'!'), so eventToChord would emit
		// `Mod+Shift+!` and never match a digit binding. Mod+7/8 sit past the
		// Mod+0–6 heading.cycle range and carry no Shift, so a real keypress
		// round-trips — the same family as the built-in heading bindings. Both args
		// are strings: the passthrough the descriptor's `unknown` arg exists to carry.
		keymap: [
			{ chord: 'Mod+7', command: setKind, arg: 'note' },
			{ chord: 'Mod+8', command: setKind, arg: 'warning' }
		]
	});

	// Reserved-child-0 chrome via the public seam: no `$lib` component import, the
	// leaf is kind-sticky (contextDependentKind) so typing keeps `note-title`, and
	// the seam's default keymap applies (Enter descends; Backspace/Delete merge).
	registerChromeLeaf(noteTitle, { blockClass: 'note-title' });
}
