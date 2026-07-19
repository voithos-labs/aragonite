/**
 * Registration for the admonition kind: directive dispatch, container descriptor,
 * the kind-cycle command, and the title chrome leaf. Reuses the shared `:::name`
 * grammar rather than a hand-written opener — the fence bytes are the round-trip
 * truth, rebuilt from children + metadata by `rebuildAdmonitionRaw`.
 */
import {
	activateDirectives,
	chromeChild,
	createDirectiveRebuild,
	registerBlockKind,
	registerBlockCommand,
	registerChromeLeaf,
	registerDirective,
	registerPasteTransform,
	isDirectiveRegistered,
	setPluginMetadata,
	getPluginMetadata,
	type CstNode,
	type ParsedDirective,
	type PluginBlockKind
} from '$lib/plugin';
import {
	ADMONITION_KINDS,
	declareAdmonitionKinds,
	admonitionTitleKind,
	isAdmonitionName,
	type AdmonitionMetadata
} from './kinds';
import { githubAlertsPasteTransform } from './convert-document';

/**
 * Build the container from a parsed `:::note` fence. Child 0 is the title
 * (the opener line's info, editable); children 1+ are the parsed body. The
 * verbatim fence bytes go to metadata so `raw` can be rebuilt after any edit.
 */
function admonitionFromDirective(kind: PluginBlockKind) {
	return (parsed: ParsedDirective): CstNode => {
		const title = parsed.fence.info.trim();
		const node: CstNode = {
			kind,
			leadingTrivia: parsed.leadingTrivia,
			raw: parsed.raw,
			innerPrefix: parsed.body?.prefix ?? '',
			children: [chromeChild(admonitionTitleKind(), title), ...(parsed.body?.children ?? [])],
			innerSuffix: parsed.body?.suffix ?? ''
		};
		setPluginMetadata<AdmonitionMetadata>(node, {
			name: parsed.fence.name,
			colonCount: parsed.fence.colonCount,
			closerColonCount: parsed.closerColonCount,
			closerNewline: parsed.closerNewline,
			lineEnding: parsed.lineEnding
		});
		return node;
	};
}

/** Re-emit `raw` from children + metadata after any structural or title edit. */
const rebuildAdmonitionRaw = createDirectiveRebuild<AdmonitionMetadata>(
	(meta) => meta?.name ?? ADMONITION_KINDS[0]
);

export function registerAdmonitions(): void {
	activateDirectives(); // idempotent; the shared grammar must be live before the first parse

	const { admonition, title } = declareAdmonitionKinds();
	const build = admonitionFromDirective(admonition);

	// All five names resolve to one kind; the kind reads its variant back from
	// metadata. Any unregistered `:::name` falls through to the generic fallback.
	for (const name of ADMONITION_KINDS) {
		if (!isDirectiveRegistered('container', name)) {
			registerDirective('container', name, { kind: admonition, fromDirective: build });
		}
	}

	// Cycle the focused admonition's kind. `updateMetadata` is the sanctioned
	// commit path: it merges the patch, runs rebuildRaw, and makes one undoable
	// edit — and because the name flows into raw, the switch survives a round-trip.
	const cycleKind = registerBlockCommand(admonition, 'admonition.cycleKind', (ctx) => {
		const meta = getPluginMetadata<AdmonitionMetadata>(ctx.node);
		const dir = ctx.arg === 'prev' ? -1 : 1;
		const current = meta?.name ?? ADMONITION_KINDS[0];
		const at = ADMONITION_KINDS.indexOf(current as (typeof ADMONITION_KINDS)[number]);
		const from = at < 0 ? 0 : at;
		const next = ADMONITION_KINDS[(from + dir + ADMONITION_KINDS.length) % ADMONITION_KINDS.length];
		ctx.updateMetadata({ name: next });
		return true;
	});

	registerBlockKind(admonition, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			// The title lives in the opener line, so raw is not a strip of the
			// children: 'opaque' marks raw authoritative.
			contract: 'opaque',
			rebuildRaw: rebuildAdmonitionRaw,
			reservedChrome: { kind: title },
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		keymap: [{ chord: 'Mod+7', command: cycleKind }],
		conformanceFixture: ':::note Heads up\n\nbody\n\n:::\n',
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'container contract=opaque — rebuildAdmonitionRaw (directive)'
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
				via: 'updateMetadata — the kind cycle commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a copy starting mid-title into the body drops the container wrapper (issues.md)'
			},
			simOracle: {
				mode: 'implemented',
				via: 'admonition + paste-transform e2e under the [invariant:] watcher'
			}
		}
	});

	registerChromeLeaf(title, { blockClass: 'admonition-title' });

	// Pasted GitHub-alert blockquotes convert to `:::name` source pre-parse — the
	// fence-safe sibling of the host convert button (which serves loaded documents).
	registerPasteTransform(githubAlertsPasteTransform);
}

export { isAdmonitionName };
