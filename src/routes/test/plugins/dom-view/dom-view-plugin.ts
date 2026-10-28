/**
 * Three blocks drawn by `defineBlockView`, one per surface, for the e2e suite that drives DOM views
 * in a real browser: an `@@ ` memo leaf with a badge before its text, a `[[dom-badge]]` block drawn
 * whole, and a `:::dombox` container. Each counts its mounts, updates and destroys on
 * `window.__domViewLog`. Dev and e2e harness only.
 */

import {
	OPENER_PRIORITIES,
	activateDirectives,
	containerClosure,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	defineBlockView,
	definePlugin,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerDirective,
	setPluginMetadata,
	simpleLeafClosure,
	type BlockViewHandle,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from '#lib/plugin.js';

export const DOM_MEMO = 'dom-memo';
export const DOM_BADGE = 'dom-badge';
export const DOM_BOX = 'dombox';
const BADGE_LINE = '[[dom-badge]]';

type Counts = Record<'mounts' | 'updates' | 'destroys', Record<string, number>>;

function counts(): Counts {
	const w = window as unknown as { __domViewLog?: Counts };
	w.__domViewLog ??= { mounts: {}, updates: {}, destroys: {} };
	return w.__domViewLog;
}

function counted(kind: string): BlockViewHandle {
	const log = counts();
	log.mounts[kind] = (log.mounts[kind] ?? 0) + 1;
	return {
		update: () => {
			log.updates[kind] = (log.updates[kind] ?? 0) + 1;
		},
		destroy: () => {
			log.destroys[kind] = (log.destroys[kind] ?? 0) + 1;
		}
	};
}

const memoView = defineBlockView({
	surface: 'leaf',
	mount(target, ctx) {
		target.className = 'dom-memo';
		const badge = document.createElement('span');
		badge.className = 'dom-memo-badge';
		badge.textContent = 'memo';
		badge.contentEditable = 'false';
		const text = document.createElement('div');
		text.className = 'dom-memo-text';
		target.append(badge, text);
		ctx.leaf.attach(text);
		return counted(DOM_MEMO);
	}
});

const badgeView = defineBlockView({
	surface: 'none',
	mount(target, ctx) {
		target.className = 'dom-badge';
		target.tabIndex = -1;
		target.textContent = 'a badge drawn by hand';
		ctx.block.publish({
			focus: () => target.focus({ preventScroll: true }),
			getCursorOffset: () => null,
			focusable: true
		});
		return counted(DOM_BADGE);
	}
});

const boxView = defineBlockView({
	surface: 'container',
	mount(target, ctx) {
		target.className = 'dombox';
		ctx.container.mountChildren(target);
		return counted(DOM_BOX);
	}
});

interface DomBoxMetadata {
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

function domBoxFromDirective(parsed: ParsedDirective): CstNode {
	const node: CstNode = {
		kind: declaredPluginKind(DOM_BOX),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: parsed.body?.children ?? [],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<DomBoxMetadata>(node, {
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline,
		lineEnding: parsed.lineEnding
	});
	return node;
}

function registerDomViews(): void {
	activateDirectives();
	const memo = declarePluginKind(DOM_MEMO);
	const badge = declarePluginKind(DOM_BADGE);
	const box = declarePluginKind(DOM_BOX);

	registerBlockKind(memo, {
		view: memoView,
		opener: {
			priority: OPENER_PRIORITIES.thematicBreak - 6,
			interruptsParagraph: (text) => text.startsWith('@@ '),
			tryOpen: (ctx) =>
				ctx.line.text.startsWith('@@ ')
					? {
							node: { kind: memo, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
							consumed: 1
						}
					: null
		},
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'the leaf surface' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: 'plain mode, a commit per keystroke' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockKind(badge, {
		view: badgeView,
		opener: {
			priority: OPENER_PRIORITIES.linkReferenceDefinition - 6,
			interruptsParagraph: (text) => text === BADGE_LINE,
			tryOpen: (ctx) =>
				ctx.line.text === BADGE_LINE
					? {
							node: { kind: badge, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
							consumed: 1
						}
					: null
		},
		blockFocus: 'whole-block',
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'the view focuses its own element' },
			searchPaint: { mode: 'not-supported', reason: 'its drawn text holds no source' },
			undo: { mode: 'inherit-default' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerDirective('container', DOM_BOX, { kind: box, fromDirective: domBoxFromDirective });
	registerBlockKind(box, {
		view: boxView,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: createDirectiveRebuild(),
			bodyWrap: DIRECTIVE_BODY_WRAP
		},
		closure: containerClosure({
			roundTripVia: 'container contract=opaque, the directive rebuild',
			focus: { mode: 'implemented', via: 'the container surface' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the title re-emits the box, as the callout does'
			},
			simOracle: { mode: 'inherit-default' }
		})
	});
}

export const domViewPlugin: EditorPlugin = definePlugin({
	name: 'dom-view',
	setup: registerDomViews
});
