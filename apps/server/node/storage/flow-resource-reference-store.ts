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
    this.replace(ownerId, flowId, scope, 'variable', names)
  }

  replaceResources(
    ownerId: string,
    flowId: string,
    scope: 'draft' | 'live',
    resources: { readonly variableNames: readonly string[]; readonly calledFlowIds?: readonly string[] } | null,
  ): void {
    this.replace(ownerId, flowId, scope, 'variable', resources?.variableNames ?? [])
    this.replace(ownerId, flowId, scope, 'flow', resources?.calledFlowIds ?? [])
  }

  private replace(ownerId: string, flowId: string, scope: 'draft' | 'live', kind: 'variable' | 'flow', keys: readonly string[]): void {
    this.#database.prepare('DELETE FROM flow_resource_references WHERE source_flow_id = ? AND scope = ? AND relation_kind = ?').run(flowId, scope, kind)
    const insert = this.#database.prepare(`INSERT INTO flow_resource_references
      (owner_id, source_flow_id, scope, relation_kind, target_key) VALUES (?, ?, ?, ?, ?)`)
    for (const key of new Set(keys)) insert.run(ownerId, flowId, scope, kind, key)
  }

  flowReferences(ownerId: string, flowId: string, direction: 'incoming' | 'outgoing', offset = 0, limit = 50) {
    const outgoing = direction == 'outgoing'
    const identity = outgoing ? 'r.target_key' : 'r.source_flow_id'
    const filter = outgoing ? 'r.source_flow_id' : 'r.target_key'
    const page = this.#database
      .prepare(`WITH matches AS (SELECT ${identity} AS flowId, f.name, f.status,
      MAX(r.scope = 'draft') AS draft, MAX(r.scope = 'live') AS live,
      l.publication_id AS publicationId, l.enabled
      FROM flow_resource_references r
      JOIN flows source ON source.flow_id = r.source_flow_id AND source.owner_id = r.owner_id AND source.status = 'active'
      LEFT JOIN flows f ON f.flow_id = ${identity} AND f.owner_id = r.owner_id
      LEFT JOIN flow_live l ON l.flow_id = ${outgoing ? 'source.flow_id' : 'f.flow_id'}
      WHERE r.owner_id = ? AND r.relation_kind = 'flow' AND ${filter} = ?
      GROUP BY ${identity})
      SELECT (SELECT COUNT(*) FROM matches) AS total,
      (SELECT json_group_array(json_object('flowId', flowId, 'name', name, 'status', status, 'draft', draft, 'live', live, 'publicationId', publicationId, 'enabled', enabled))
        FROM (SELECT * FROM matches ORDER BY flowId LIMIT ? OFFSET ?)) AS items`)
      .get(ownerId, flowId, limit + 1, offset) as { total: number; items: string }
    const rows = JSON.parse(page.items) as {
      flowId: string
      name: string | null
      status: string | null
      draft: number
      live: number
      publicationId: string | null
      enabled: number | null
      total: number
    }[]
    return {
      version: 1 as const,
      direction,
      total: page.total,
      references: rows.slice(0, limit).map((row) => ({
        flowId: row.flowId,
        name: row.name,
        available: row.status == 'active',
        draft: row.draft == 1,
        live: row.live == 1 && row.publicationId != null ? { publicationId: row.publicationId, enabled: row.enabled == 1 } : null,
      })),
      ...(rows.length > limit ? { nextOffset: offset + limit } : {}),
    }
  }

  delete(flowId: string): void {
    this.#database.prepare('DELETE FROM flow_resource_references WHERE source_flow_id = ?').run(flowId)
  }
}
