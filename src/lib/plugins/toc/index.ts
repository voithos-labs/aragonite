// TOC plugin — public entry. `tocPlugin(options?)` teaches the editor the `[[toc]]`
// leaf that renders the document's heading outline (hierarchy + click-to-navigate);
// `TOC_BLOCK` names its kind, `maxDepth` bounds the listed heading levels.
export { tocPlugin, TOC_BLOCK } from './toc-plugin';
export type { TocOptions, MaxHeadingLevel } from './toc-plugin';
