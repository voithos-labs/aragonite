/**
 * Three blocks drawn by `defineBlockView`, one per surface, for the e2e suite that drives DOM views
 * in a real browser: an `@@ ` memo leaf with a badge before its text, a `[[dom-badge]]` block drawn
 * whole, and a `:::dombox` container. Each counts its mounts, updates and destroys on
 * `window.__domViewLog`. Dev and e2e harness only.
 */

import {
	OPENER_PRIORITIES,
	activateDirectives,
	declarePluginKind,
	declaredPluginKind,
	defineBlockView,
	definePlugin,
	COLON_LINES,
	registerBlockKind,
	registerDirective,
	setPluginMetadata,
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
		supportsInline: false
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
		supportsInline: false
	});

	registerDirective('container', DOM_BOX, { kind: box, fromDirective: domBoxFromDirective });
	registerBlockKind(box, {
		view: boxView,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			lines: COLON_LINES
		}
	});
}

export const domViewPlugin: EditorPlugin = definePlugin({
	name: 'dom-view',
	setup: registerDomViews
});
