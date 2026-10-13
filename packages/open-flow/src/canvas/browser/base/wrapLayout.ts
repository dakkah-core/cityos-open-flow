interface LayoutNode {
  readonly id: string
  readonly column: number
  readonly x: number
  readonly y: number
  readonly height: number
}

const columnsPerRow = 4
const rowGap = 160

/** Wrap whole dependency columns; viewport changes must not change the layout. */
export function wrapLayout(nodes: readonly LayoutNode[]): Readonly<Record<string, { x: number; y: number }>> {
  const byColumn = Map.groupBy(nodes, (node) => node.column)
  const columns = [...byColumn.keys()].toSorted((a, b) => a - b)
  const positions: Record<string, { x: number; y: number }> = {}
  let rowTop = 0
  let rowLeft = 0
  for (let start = 0; start < columns.length; start += columnsPerRow) {
    const row = columns.slice(start, start + columnsPerRow).flatMap((column) => byColumn.get(column)!)
    const left = Math.min(...row.map((node) => node.x))
    const top = Math.min(...row.map((node) => node.y))
    const bottom = Math.max(...row.map((node) => node.y + node.height))
    if (start == 0) {
      rowLeft = left
      rowTop = top
    }
    for (const node of row) positions[node.id] = { x: node.x - left + rowLeft, y: node.y - top + rowTop }
    // Leave a clear return lane between rows, including rows containing tall branches.
    rowTop += bottom - top + rowGap
  }
  return positions
}
