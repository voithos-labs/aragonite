/**
 * The reference `:::name` directive container. Reuses the shared directive grammar rather
 * than a hand-written opener, so the fence bytes stay the round-trip truth.
 */
import {
	activateDirectives,
	declarePluginKind,
	COLON_LINES,
	registerBlockKind,
	registerBlockCommand,
	registerDirective,
	isDirectiveRegistered,
	setPluginMetadata,
	getPluginMetadata,
	withDirectiveName,
	type BlockView,
	type CstNode,
	type ParsedDirective,
	type PluginBlockKind
} from '#lib/plugin.js';
import {
	ADMONITION,
	ADMONITION_KINDS,
	coerceAdmonitionName,
	type AdmonitionMetadata
} from './kinds';
import { registerGithubAlert } from './github-alert-kind';

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
			name: parsed.fence.name
		});
		return node;
	};
}

/** `view` draws both the admonition and the GitHub alert. */
export function registerAdmonitions(view: BlockView): void {
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
			lines: COLON_LINES
		},
		keymap: [{ chord: 'Mod+7', command: cycleKind }],
		samples: [':::note Heads up\n\nbody\n\n:::\n']
	});

	registerGithubAlert(view);
}
