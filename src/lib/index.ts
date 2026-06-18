// Public, supported surface of the editor module. Adding an export here is
// non-breaking; removing one is breaking — keep this minimal and grow on demand.
// Anything not re-exported here is internal and may change without notice.

// ── Component ────────────────────────────────────────────────────────────────

export { default as Editor } from './components/Editor.svelte';

import type { ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
import type { ImageLoadPolicy } from './core/inline-render';

export interface EditorProps {
	source?: string;
	resolveImageUrl?: ResolveImageUrl;
	resolveLinkUrl?: ResolveLinkUrl;
	imageLoadPolicy?: ImageLoadPolicy;
	onLinkActivate?: (url: string, event: MouseEvent) => void;
}

export type { BlockComponent } from './block-component';
export type { ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
export type { ImageLoadPolicy } from './core/inline-render';

// ── CST utilities ────────────────────────────────────────────────────────────

export { parse } from './core/parser';
export { serialize } from './core/serializer';
export { parseInline, getContentRange, isProseKind } from './core/inline';
export type { ContentRange } from './core/inline';

// ── Node & inline types ──────────────────────────────────────────────────────

export type {
	BlockKind,
	LeafBlockKind,
	ContainerBlockKind,
	CstNode,
	Document,
	BlockMetadata,
	HeadingMetadata,
	SetextHeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	LinkReferenceDefinitionMetadata,
	TableMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata,
	InlineNodeKind,
	InlineNode
} from './core/nodes';

// ── Events ───────────────────────────────────────────────────────────────────

export type {
	EditorEvents,
	EditEvent,
	EditorEventMap,
	EditorError,
	SelectionChangeEvent
} from './editor-events';
