/**
 * The reference `:::name` directive container. Reuses the shared directive grammar rather
 * than a hand-written opener, so the fence bytes stay the round-trip truth.
 */
import {
	activateDirectives,
	containerClosure,
	createDirectiveRebuild,
	declarePluginKind,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerBlockCommand,
	registerDirective,
	registerPasteTransform,
	isDirectiveRegistered,
	setPluginMetadata,
	getPluginMetadata,
	withDirectiveName,
	type BlockView,
	type CstNode,
	type ParsedDirective,
	type PluginBlockKind
} from '@voithos-labs/aragonite/plugin';
import {
	ADMONITION,
	ADMONITION_KINDS,
	coerceAdmonitionName,
	type AdmonitionMetadata
} from './kinds';
import { githubAlertsPasteTransform } from './convert-document';
import { registerGithubAlert } from './github-alert-kind';

export interface AdmonitionsOptions {
	/**
	 * Rewrite pasted GitHub-alert blockquotes to `:::name` source before the parse
	 * (default false). Off, they stay GitHub bytes and render as `githubAlert`.
	 */
	convertAlertsOnPaste?: boolean;
}

/** The body's blocks; the grammar puts the opener line, which holds the title, in front of them. */
function admonitionFromDirective(kind: PluginBlockKind) {
	return (parsed: ParsedDirective): CstNode => {
		const node: CstNode = {
			kind,
			leadingTrivia: parsed.leadingTrivia,
			raw: parsed.raw,
			innerPrefix: parsed.body?.prefix ?? '',
			children: parsed.body?.children ?? [],
			innerSuffix: parsed.body?.suffix ?? ''
		};
		setPluginMetadata<AdmonitionMetadata>(node, {
			name: parsed.fence.name,
			closerColonCount: parsed.closerColonCount,
			closerNewline: parsed.closerNewline
		});
		return node;
	};
}

const rebuildAdmonitionRaw = createDirectiveRebuild();

/** `view` draws both the admonition and the GitHub alert. */
export function registerAdmonitions(view: BlockView, options?: AdmonitionsOptions): void {
	activateDirectives(); // idempotent; the shared grammar must be live before the first parse

	const admonition = declarePluginKind(ADMONITION);
	const build = admonitionFromDirective(admonition);

	// Every name resolves to one kind, which reads its variant back from metadata. A name
	// something else claimed first stays theirs.
	for (const name of ADMONITION_KINDS) {
		if (!isDirectiveRegistered('container', name)) {
			registerDirective('container', name, { kind: admonition, fromDirective: build });
		}
	}

	// The name lives on the opener line, so the cycle rewrites that line as one undoable edit.
	const cycleKind = registerBlockCommand(admonition, 'admonition.cycleKind', (ctx) => {
		const meta = getPluginMetadata<AdmonitionMetadata>(ctx.node);
		const dir = ctx.arg === 'prev' ? -1 : 1;
		const from = ADMONITION_KINDS.indexOf(coerceAdmonitionName(meta?.name));
		const next = ADMONITION_KINDS[(from + dir + ADMONITION_KINDS.length) % ADMONITION_KINDS.length];
		ctx.replaceRaw(withDirectiveName(ctx.node.raw, next));
		return true;
	});

	registerBlockKind(admonition, {
		view,
		label: 'Admonition',
		// A note reads as part of the text around it, so it shows no drag handle.
		pageRole: 'prose',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		// An opaque container has no text at either edge for the caret to step into, so both
		// edges take the gap caret.
		gapEdges: 'both',
		container: {
			// The fence lines frame the children, so raw is not a strip of them.
			contract: 'opaque',
			rebuildRaw: rebuildAdmonitionRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP
		},
		keymap: [{ chord: 'Mod+7', command: cycleKind }],
		conformanceFixture: ':::note Heads up\n\nbody\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildAdmonitionRaw (directive)',
			focus: { mode: 'implemented', via: 'focus walks to the opener line / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: {
				mode: 'implemented',
				via: 'replaceRaw: the kind cycle rewrites the opener line as one undoable edit'
			},
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the opener line re-emits the admonition: a mid-title start reopens it around the collected body, a mid-title end yields a title-only admonition'
			},
			simOracle: {
				mode: 'implemented',
				via: 'admonition + paste-transform e2e under the [invariant:] watcher'
			}
		})
	});

	if (options?.convertAlertsOnPaste) {
		registerPasteTransform(githubAlertsPasteTransform);
	}

	registerGithubAlert(view);
}
