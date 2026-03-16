export async function isOctopusesEnabled(): Promise<boolean> {
  try {
    const response = await fetch("/api/feature-flags/octopuses");
    const { enabled } = (await response.json()) as { enabled: boolean };
    return enabled ?? true;
  } catch {
    return true;
  }
}
