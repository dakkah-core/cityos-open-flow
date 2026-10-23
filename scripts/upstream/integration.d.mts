export interface SourceIdentity { sourceSha: string; sourceDigest: string; dirty: boolean }
export function captureSourceIdentity(root: string): SourceIdentity;
