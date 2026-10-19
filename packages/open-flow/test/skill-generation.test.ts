import { render } from 'agentic-markdown'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { generateSkill } from '../scripts/generate-skill.ts'

it('generates a self-contained local skill and removes obsolete output without touching siblings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-skill-'))
  const output = path.join(directory, 'open-flow')
  try {
    await writeFile(path.join(directory, 'unrelated.md'), 'keep')
    await generateSkill(output)
    await writeFile(path.join(output, 'obsolete.md'), 'old')
    await generateSkill(output)
    expect(await readFile(path.join(directory, 'unrelated.md'), 'utf8')).toBe('keep')
    await expect(readFile(path.join(output, 'obsolete.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const entry = await readFile(path.join(output, 'SKILL.md'), 'utf8')
    expect(entry).toMatch(/^---\r?\nname: open-flow\r?\ndescription: [^\r\n]+\r?\n---/)
    for (const [, reference] of entry.matchAll(/\]\((references\/[^)]+)\)/g)) {
      const content = await readFile(path.join(output, reference!), 'utf8')
      expect(content).toContain('bun run flow --')
      expect(content).not.toContain('agentic:')
    }
    expect(entry).not.toContain('agentic:')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('renders the shipped skill for the oo host with resolvable references', async () => {
  const root = path.resolve(import.meta.dirname, '../skills/open-flow')
  const entry = render(await readFile(path.join(root, 'SKILL.md'), 'utf8'), { flowCommand: 'oo flow' })
  expect(entry).toContain('oo flow')
  expect(entry).not.toContain('agentic:')
  for (const [, reference] of entry.matchAll(/\]\((references\/[^)]+)\)/g)) {
    const content = render(await readFile(path.join(root, reference!), 'utf8'), { flowCommand: 'oo flow' })
    expect(content).not.toContain('agentic:')
    expect(content).toContain('oo flow')
  }
})
