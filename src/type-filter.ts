export function exactTypeFilter(typeId: string): string | undefined {
  if (!typeId) return undefined;
  return `type eq ${JSON.stringify(typeId)}`;
}
