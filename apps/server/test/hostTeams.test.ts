import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { openService, closeService, startService } from './serviceFixture.ts'

it('resolves explicit deployment Teams without a hosted Connector client', async () => {
  const service = await openService(':memory:', {
    capabilities: {
      connectorTeams: async () => [{ id: 'installed-team', name: 'Installed Team', systemCreated: true }],
    },
  })
  const created = await service.control.createFlow('actor', 'Bound draft', 'create-bound', 'installed-team')
  expect(created.flow.connectorTeamId).toBe('installed-team')
  expect((await service.connectorTeams()).teams).toEqual([{ id: 'installed-team', name: 'Installed Team', systemCreated: true }])
  await expect(service.control.createFlow('actor', 'Wrong Team', 'wrong-team', 'other-team')).rejects.toThrow('not available')
})

it('rereads deployment Team availability instead of retaining a revoked Team', async () => {
  let available = true
  const service = await openService(':memory:', {
    capabilities: {
      connectorTeams: async () => (available ? [{ id: 'installed-team', name: 'Installed Team', systemCreated: true }] : []),
    },
  })
  await service.control.createFlow('actor', 'Initial', 'initial', 'installed-team')
  available = false
  await expect(service.control.createFlow('actor', 'Withdrawn', 'withdrawn', 'installed-team')).rejects.toThrow('not available')
})

it('invalid and throwing deployment Team sources fail closed without disclosing their errors', async () => {
  for (const connectorTeams of [
    async () => [
      { id: 'duplicate', name: 'One', systemCreated: true },
      { id: 'duplicate', name: 'Two', systemCreated: true },
    ],
    async () => {
      throw Error('private-provider-value')
    },
  ]) {
    const service = await openService(':memory:', { capabilities: { connectorTeams } })
    await expect(service.control.createFlow('actor', 'Invalid', 'invalid', 'duplicate')).rejects.toThrow('Configured Connector Team source unavailable')
  }
})

it('rejects invalid Team references including embedded control bytes', async () => {
  for (const id of ['', ' leading', 'trailing ', 'team\nline', 'team\u0000id', 'team\u007fid']) {
    const service = await openService(':memory:', {
      capabilities: { connectorTeams: async () => [{ id, name: 'Installed Team', systemCreated: true }] },
    })
    try {
      await expect(service.connectorTeams()).rejects.toThrow('Configured Connector Team source unavailable.')
    } finally {
      await closeService(service)
    }
  }
})

it('a deployment Team source never assigns existing unbound Flows during listing or startup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-host-team-'))
  const opened: Awaited<ReturnType<typeof openService>>[] = []
  try {
    const file = path.join(directory, 'legacy.sqlite')
    const legacy = await openService(file)
    opened.push(legacy)
    const created = await legacy.control.createFlow('actor', 'Legacy unbound', 'legacy')
    expect(created.flow.connectorTeamId).toBeUndefined()
    await closeService(legacy)
    const current = await openService(file, {
      capabilities: {
        connectorTeams: async () => [{ id: 'installed-team', name: 'Installed Team', systemCreated: true }],
      },
    })
    opened.push(current)
    await current.connectorTeams()
    await startService(current)
    expect((await current.connectorTeams()).bindings).toEqual([])
    expect(current.control.getFlow(created.flow.flowId).connectorTeamId).toBeUndefined()
  } finally {
    for (const service of opened) await closeService(service)
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()))
    expect(path.basename(directory).startsWith('open-flow-host-team-')).toBe(true)
    await rm(directory, { recursive: true, force: true })
  }
})
