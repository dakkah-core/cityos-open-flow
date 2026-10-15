import type { VariableReference, VariableReferences } from '@oomol-lab/open-flow/control-api'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Owns current resource-reference edges and reverse lookup.
 * Mutations borrow the Draft, Live, or retirement transaction; they never resolve revisions.
 */
export class FlowResourceReferenceStore {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  variableReferences(ownerId: string, name: string): VariableReferences {
    const rows = this.#database
      .prepare(`
      SELECT f.flow_id AS flowId, f.name AS flowName,
        MAX(r.scope = 'draft') AS draft, MAX(r.scope = 'live') AS live,
        l.publication_id AS publicationId, l.enabled
      FROM flow_resource_references r
      JOIN flows f ON f.flow_id = r.source_flow_id AND f.owner_id = r.owner_id
      LEFT JOIN flow_live l ON l.flow_id = f.flow_id
      WHERE r.owner_id = ? AND r.relation_kind = 'variable' AND r.target_key = ? AND f.status = 'active'
      GROUP BY f.flow_id
      ORDER BY f.name COLLATE BINARY, f.flow_id
    `)
      .all(ownerId, name) as unknown as readonly {
      flowId: string
      flowName: string
      draft: number
      live: number
      publicationId: string | null
      enabled: number | null
    }[]
    const references: VariableReference[] = rows.map((row) => ({
      flowId: row.flowId,
      flowName: row.flowName,
      draft: row.draft == 1,
      live: row.live == 1 && row.publicationId != null ? { publicationId: row.publicationId, enabled: row.enabled == 1 } : null,
    }))
    return { version: 1, references }
  }

  replaceVariables(ownerId: string, flowId: string, scope: 'draft' | 'live', names: readonly string[]): void {
    this.#database.prepare("DELETE FROM flow_resource_references WHERE source_flow_id = ? AND scope = ? AND relation_kind = 'variable'").run(flowId, scope)
    const insert = this.#database.prepare(`INSERT INTO flow_resource_references
      (owner_id, source_flow_id, scope, relation_kind, target_key) VALUES (?, ?, ?, 'variable', ?)`)
    for (const name of new Set(names)) insert.run(ownerId, flowId, scope, name)
  }

  delete(flowId: string): void {
    this.#database.prepare('DELETE FROM flow_resource_references WHERE source_flow_id = ?').run(flowId)
  }
}
