export function dockerQualificationArguments(argv: readonly string[], root: string): { imageId?: string; receiptPath?: string };
export function dockerDiagnosticSummary(log: string): { bytes: number; sha256: string };
export function assertImmutableLinuxImage(image: unknown, expected: string): {
  Id: string; Os: 'linux'; Architecture: 'amd64' | 'arm64'; Config?: { Labels?: Record<string, string> };
};
