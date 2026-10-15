import type { DatabaseSync } from 'node:sqlite'

import { FlowResourceReferenceStore } from './flow-resource-reference-store.ts'
import { revisionResourceReferences } from './flow-resources.ts'
import { RevisionIntegrityError, RevisionStore } from './revision-store.ts'

export function migrateFlowResourceReferences(database: DatabaseSync): void {
  database.exec(`CREATE TABLE flow_resource_references (
    owner_id TEXT NOT NULL,
    source_flow_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
    relation_kind TEXT NOT NULL,
    target_key TEXT NOT NULL,
    PRIMARY KEY (source_flow_id, scope, relation_kind, target_key)
  ) STRICT;
  CREATE INDEX flow_resource_reference_target ON flow_resource_references
    (owner_id, relation_kind, target_key, source_flow_id, scope);`)
  const references = new FlowResourceReferenceStore(database)
  const revisions = new RevisionStore(database)
  const summaries = new Map<string, ReturnType<typeof revisionResourceReferences>>()
  const rows = database
    .prepare(`SELECT f.flow_id AS flowId, f.owner_id AS ownerId,
    f.draft_revision_id AS draftRevisionId, f.draft_resource_references AS draft,
    p.revision_id AS liveRevisionId
    FROM flows f LEFT JOIN flow_live l ON l.flow_id = f.flow_id
    LEFT JOIN publications p ON p.publication_id = l.publication_id
    WHERE f.status = 'active'`)
    .all() as unknown as readonly {
    flowId: string
    ownerId: string
    draftRevisionId: string
    draft: string | null
    liveRevisionId: string | null
  }[]
  // Seed every existing Draft summary before reading any Live revision.
  for (const row of rows) {
    const summary: ReturnType<typeof revisionResourceReferences> = row.draft == null ? null : JSON.parse(row.draft)
    if (summary != null) summaries.set(row.draftRevisionId, summary)
    references.replaceVariables(row.ownerId, row.flowId, 'draft', summary?.variableNames ?? [])
  }
  for (const row of rows) {
    if (row.liveRevisionId == null) continue
    if (!summaries.has(row.liveRevisionId)) {
      let summary: ReturnType<typeof revisionResourceReferences> = null
      try {
        const revision = revisions.read(row.liveRevisionId)
        if (revision != null) summary = revisionResourceReferences(revision.content)
      } catch (error) {
        if (!(error instanceof RevisionIntegrityError)) throw error
      }
      summaries.set(row.liveRevisionId, summary)
    }
    references.replaceVariables(row.ownerId, row.flowId, 'live', summaries.get(row.liveRevisionId)?.variableNames ?? [])
  }
}
