/**
 * Serializer for the Phase 0 parser proof-of-concept document shape.
 */
import type { ProofOfConceptDocument } from "./poc-types.js";

export function serializeProofOfConceptDocument(document: ProofOfConceptDocument): string {
    return `${document.prefix}${document.blocks.map((block) => `${block.leadingTrivia}${block.source}`).join("")}${document.suffix}`;
}
