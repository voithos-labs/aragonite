/**
 * Schema layer: block-kind descriptors, component registry, merge rules,
 * and per-kind raw-rebuild dispatch. Both core/inline/ and tree-operations/
 * read from here; the schema must not depend on either to keep the layer DAG
 * acyclic.
 */

export * from './block-kind-descriptor';
export * from './container-raw';
export * from './merge-rules';
export * from './block-component-registry';
// block-components.ts is side-effect import only; not re-exported.
