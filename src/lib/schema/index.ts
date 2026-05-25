/**
 * Schema layer: block-kind descriptors, component registry, merge rules,
 * and per-kind raw-rebuild dispatch. Foundational — no downstream imports
 * into core/inline/, tree-operations/, or components/.
 *
 * Built-in component registrations live in components/built-in-blocks.ts
 * (the wire-up file imported once by Editor.svelte at mount).
 */

export * from './block-kind-descriptor';
export * from './container-raw';
export * from './merge-rules';
export * from './block-component-registry';
