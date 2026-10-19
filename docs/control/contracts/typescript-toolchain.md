# TypeScript toolchain boundary

The root Bun catalogs own dependency selections. Build and typecheck commands use
the default `typescript` catalog entry, which selects the stable TypeScript 7 CLI.
Node carriers remain governed by the root `.node-version` and their existing
toolchain conformance check. Open Flow's native runtimes are preserved.

## Browser language tooling exception

The user explicitly approved retaining the exact browser tooling binding on
2026-10-19 until TypeScript 7 supports this browser execution model. The named
`typescript-compat` catalog owns `typescript-lsp`; do not copy its version into
another manifest, toolchain pin, or compiler selection.

This binding supports the existing browser-local completions, signature help,
diagnostics and shadow-document mapping through `@typescript/vfs`. Its source
consumers are confined to `packages/open-flow/src/workbench/browser/`:

- `typeScriptWorker.ts`
- `typeScriptShadow.ts` and its regression tests
- `typeScriptDiagnostics.ts`
- `codeActionsTyping.test.ts`

The exception does not switch build/typecheck compilation to TypeScript 6 or
authorize other first-party compiler API consumers. Do not replace the browser
service with a server transport under this migration: that changes the current
execution model and requires its own product and host contract.

When a stable TypeScript 7 browser tooling implementation supports the required
APIs, migrate this boundary and its behavior tests together. Preserve generated
typing isolation, offset mapping, diagnostics, completions and signature help.
Remove the compatibility binding only after the affected package and browser
tooling checks qualify its replacement. Catalog or source conformance alone does
not prove those behaviors.
