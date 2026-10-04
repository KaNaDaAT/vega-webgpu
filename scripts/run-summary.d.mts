/** The markdown for a CI run's page, from a run's manifest and its environment. */
export function summary(run?: {
  manifest?: { cases: Record<string, unknown>[]; [key: string]: unknown } | null;
  env?: Record<string, string | undefined>;
}): string;
