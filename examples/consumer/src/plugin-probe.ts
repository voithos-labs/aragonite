import { declarePluginKind } from 'aragonite/plugin';
import type { BlockKindDescriptor } from 'aragonite/plugin';

// Type-level proof the frozen authoring surface resolves from outside the repo; never
// called, since the runtime callout registration lives in src/plugins/callout.
export const _probe = (): { kind: string; describe: (d: BlockKindDescriptor) => string } => ({
	kind: declarePluginKind('probe-kind'),
	describe: (d) => d.mergeRole
});

// Type-level proof the mermaid renderer subpath resolves, type-only by necessity: a runtime
// import pulls renderer.ts's `import('mermaid')` into a consumer with no engine (routes/plugins).
export type MermaidRendererProbe =
	typeof import('aragonite/plugins/mermaid/renderer').mermaidRenderer;

// The seam a third-party plugin's own suite installs against; type-only because the barrel is
// test-process-only. One entry per re-export cluster: each pulls a different declaration file.
export type TestingSurfaceProbe = {
	reset: typeof import('aragonite/testing').resetPluginPlatformForTests;
	containerConformance: typeof import('aragonite/testing').runContainerConformance;
	kindConformance: typeof import('aragonite/testing').runKindConformance;
	inlineKindConformance: typeof import('aragonite/testing').runInlineKindConformance;
};
