// Importing this pulls no rendering engine; the adapter lives at the `/renderer` subpath.
export { mermaidPlugin } from './register';
export { MERMAID } from './mermaid-kind';
export type { MermaidRenderer, MermaidRenderContext } from './mermaid-renderer';
