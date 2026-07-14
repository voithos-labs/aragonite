// Mermaid plugin — public entry. `mermaidPlugin({ renderer })` teaches the editor
// the ```mermaid fence; the engine is injected (the `mermaidRenderer` adapter
// lives at the `/renderer` subpath), so importing this pulls no rendering engine.
export { mermaidPlugin } from './register';
export { MERMAID } from './mermaid-kind';
export type { MermaidRenderer } from './mermaid-renderer';
