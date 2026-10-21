/** Keep declaration/compiler arenas from competing for the package's memory budget. */
export async function runBuildSteps(steps: readonly (() => Promise<unknown>)[]): Promise<void> {
  for (const step of steps) await step()
}
