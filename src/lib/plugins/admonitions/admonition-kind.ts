/**
 * The reference `:::name` directive container. Reuses the shared directive grammar rather
 * than a hand-written opener, so the fence bytes stay the round-trip truth.
 */
import {
	activateDirectives,
	chromeChild,
	containerClosure,
	createDirectiveRebuild,
	defineBlockComponent,
	DIRECTIVE_BODY_WRAP,
	registerBlockComponent,
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
	coerceAdmonitionName,
	declareAdmonitionKinds,
	admonitionTitleKind,
	type AdmonitionMetadata
} from './kinds';
import { githubAlertsPasteTransform } from './convert-document';
import { registerGithubAlert } from './github-alert-kind';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export interface AdmonitionsOptions {
	/**
	 * Rewrite pasted GitHub-alert blockquotes to `:::name` source before the parse
	 * (default false). Off, they stay GitHub bytes and render as `githubAlert`.
	 */
	convertAlertsOnPaste?: boolean;
}

/** Child 0 is the title (the opener line's info, editable); children 1+ are the body. */
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

const rebuildAdmonitionRaw = createDirectiveRebuild<AdmonitionMetadata>((meta) =>
	coerceAdmonitionName(meta?.name)
);

export function registerAdmonitions(options?: AdmonitionsOptions): void {
	activateDirectives(); // idempotent; the shared grammar must be live before the first parse

	const { admonition, title } = declareAdmonitionKinds();
	const build = admonitionFromDirective(admonition);

	// Every name resolves to one kind, which reads its variant back from metadata.
	for (const name of ADMONITION_KINDS) {
		if (!isDirectiveRegistered('container', name)) {
			registerDirective('container', name, { kind: admonition, fromDirective: build });
		}
	}

	// `updateMetadata` is the sanctioned commit path: patch, rebuildRaw, one undoable edit.
	const cycleKind = registerBlockCommand(admonition, 'admonition.cycleKind', (ctx) => {
		const meta = getPluginMetadata<AdmonitionMetadata>(ctx.node);
		const dir = ctx.arg === 'prev' ? -1 : 1;
		const from = ADMONITION_KINDS.indexOf(coerceAdmonitionName(meta?.name));
		const next = ADMONITION_KINDS[(from + dir + ADMONITION_KINDS.length) % ADMONITION_KINDS.length];
		ctx.updateMetadata({ name: next });
		return true;
	});

	registerBlockKind(admonition, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		// Opaque tier rule: no textual escape hatch at either edge, so both take the gap caret.
		gapEdges: 'both',
		container: {
			// The title lives in the opener line, so raw is not a strip of the children.
			contract: 'opaque',
			rebuildRaw: rebuildAdmonitionRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: title },
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		keymap: [{ chord: 'Mod+7', command: cycleKind }],
		conformanceFixture: ':::note Heads up\n\nbody\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildAdmonitionRaw (directive)',
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: {
				mode: 'implemented',
				via: 'updateMetadata — the kind cycle commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the title re-emits the callout — a mid-title start reopens it around the collected body, a mid-title end yields a title-only callout'
			},
			simOracle: {
				mode: 'implemented',
				via: 'admonition + paste-transform e2e under the [invariant:] watcher'
			}
		})
	});

	registerChromeLeaf(title, { blockClass: 'admonition-title' });
	registerBlockComponent(admonition, defineBlockComponent(AdmonitionBlock));

	if (options?.convertAlertsOnPaste) {
		registerPasteTransform(githubAlertsPasteTransform);
	}

	// The component registered above renders both kinds.
	registerGithubAlert();
}
