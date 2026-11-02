export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.prompt_tokens === "number" &&
    Number.isInteger(record.prompt_tokens) &&
    record.prompt_tokens >= 0 &&
    typeof record.completion_tokens === "number" &&
    Number.isInteger(record.completion_tokens) &&
    record.completion_tokens >= 0
  );
}
