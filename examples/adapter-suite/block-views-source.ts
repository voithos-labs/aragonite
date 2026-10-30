// The `?block-views` page's documents, shared by the apps and the spec.
export const BLOCK_VIEWS_SOURCE =
	'%% a memo\n\n@@ a label\n\n:::box The box\ninside the box\n:::\n\na {{pebble}} chip\n\n```note\nhello note\n```\n\nafter the blocks\n\n!! d6\n\nthe end\n';

// Long enough that scrolling to its end unmounts the blocks at its top.
export const LONG_SOURCE =
	BLOCK_VIEWS_SOURCE + Array.from({ length: 300 }, (_, i) => `\nfiller ${i + 1}\n`).join('');
