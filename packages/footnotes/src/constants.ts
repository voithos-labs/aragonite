// Plain strings, not branded declarations, so a consumer can filter on kind without
// importing the registration modules.
export const FOOTNOTE_DEF_KIND = 'footnote-def';

export const FOOTNOTE_REF_KIND = 'footnote-ref';

// Accessible names, kept with the plugin so it carries its own strings.
export const footnoteReferenceLabel = (number: string): string => `Footnote ${number}`;
export const backToReferenceLabel = (label: string): string => `Back to reference ${label}`;
