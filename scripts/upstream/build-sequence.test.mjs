import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runBuildSteps } from '../../packages/open-flow/scripts/buildSequence.ts'

test('heavy distribution steps never hold compiler memory concurrently', async () => {
  let active = 0,
    maximum = 0
  const completed = []
  await runBuildSteps(
    [0, 1, 2].map((index) => async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setImmediate(resolve))
      completed.push(index)
      active--
    }),
  )
  assert.equal(maximum, 1)
  assert.equal(active, 0)
  assert.deepEqual(completed, [0, 1, 2])
})

test('a failed build step prevents later builds and archive assembly', async () => {
  const completed = []
  await assert.rejects(
    runBuildSteps([
      async () => {
        completed.push('types')
        throw Error('compiler failed')
      },
      async () => {
        completed.push('browser')
      },
      async () => {
        completed.push('archive')
      },
    ]),
    /compiler failed/,
  )
  assert.deepEqual(completed, ['types'])
})
