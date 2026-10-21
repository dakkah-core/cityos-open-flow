import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./wait-for-ci.sh', import.meta.url))

function run(t, responses, ref = 'refs/heads/main', apiExit = 0) {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-ci-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(
    path.join(directory, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs')
const responses = ${JSON.stringify(responses)}
const calls = fs.existsSync(process.env.CALLS) ? JSON.parse(fs.readFileSync(process.env.CALLS)) : []
const response = responses[Math.min(calls.length, responses.length - 1)]
calls.push(process.argv.slice(2))
fs.writeFileSync(process.env.CALLS, JSON.stringify(calls))
if (response) console.log(response)
process.exit(${apiExit})
`,
    { mode: 0o755 },
  )
  writeFileSync(path.join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const calls = path.join(directory, 'calls.json')
  writeFileSync(calls, '[]')
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: directory + path.delimiter + process.env.PATH,
      CALLS: calls,
      GITHUB_REF: ref,
      GITHUB_REPOSITORY: 'oomol-lab/open-flow',
      GITHUB_SHA: 'release-sha',
    },
  })
  assert.ifError(result.error)
  return { ...result, calls: JSON.parse(readFileSync(calls, 'utf8')) }
}

test('waits for registration and completion of the exact main push CI', (t) => {
  const result = run(t, ['', '42\tqueued\t', '42\tin_progress\t', '42\tcompleted\tsuccess'])
  assert.equal(result.status, 0)
  assert.equal(result.calls.length, 4)
  for (const args of result.calls) {
    assert.deepEqual(args.slice(0, 14), [
      'run',
      'list',
      '--repo',
      'oomol-lab/open-flow',
      '--workflow',
      'ci.yaml',
      '--branch',
      'main',
      '--event',
      'push',
      '--commit',
      'release-sha',
      '--limit',
      '1',
    ])
  }
  assert.match(result.stdout, /actions\/runs\/42/)
})

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', '']) {
  test(`rejects completed CI with conclusion "${conclusion}"`, (t) => {
    const result = run(t, [`42\tcompleted\t${conclusion}`])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Publication stopped/)
  })
}

test('rejects a non-main ref before querying CI', (t) => {
  const result = run(t, ['42\tcompleted\tsuccess'], 'refs/heads/feature')
  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 0)
})

test('fails when no matching CI appears', (t) => {
  const result = run(t, [''])
  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 6)
  assert.match(result.stderr, /No main push CI run found/)
})

test('bounds waiting for a CI run that never completes', (t) => {
  const result = run(t, ['42\tin_progress\t'])
  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 120)
  assert.match(result.stderr, /within 20 minutes/)
})

test('stops on a GitHub API error', (t) => {
  const result = run(t, [''], 'refs/heads/main', 4)
  assert.equal(result.status, 4)
  assert.equal(result.calls.length, 1)
})
