import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'

export function dockerDiagnosticSummary(log) {
  const bytes = Buffer.from(log)
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function dockerQualificationArguments(argv, root) {
  const result = { imageId: undefined, receiptPath: undefined }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index],
      value = argv[index + 1]
    assert.ok(['--image', '--receipt'].includes(key) && typeof value === 'string' && value.length > 0, 'Invalid Docker qualification arguments')
    const field = key === '--image' ? 'imageId' : 'receiptPath'
    assert.equal(result[field], undefined, 'Duplicate Docker qualification argument')
    result[field] = value
  }
  if (result.imageId !== undefined) assert.match(result.imageId, /^sha256:[a-f0-9]{64}$/u, 'An immutable local image ID is required')
  if (result.receiptPath !== undefined) {
    assert.ok(result.imageId, 'An image receipt must test an existing immutable image, without rebuilding')
    const base = path.resolve(root, '.build/upstream'),
      file = path.resolve(root, result.receiptPath),
      relative = path.relative(base, file)
    assert.ok(
      relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && file.endsWith('.json'),
      'Receipt must stay in the owned qualification output',
    )
    result.receiptPath = file
  }
  return result
}

export function assertImmutableLinuxImage(image, expected) {
  assert.match(expected, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(image?.Id, expected, 'The tested image identity changed')
  assert.equal(image?.Os, 'linux', 'A Windows archive or image cannot qualify a Linux installation')
  assert.ok(['amd64', 'arm64'].includes(image?.Architecture), 'Unsupported Linux image architecture')
  return image
}
