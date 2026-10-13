import type { LlmConfig, TestRequest, TestResult } from "@/lib/types";

export async function testConnection(config: LlmConfig): Promise<TestResult> {
  const body: TestRequest = { config };

  const res = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      latencyMs: 0,
      error: `Server error ${res.status}`,
    };
  }

  return (await res.json()) as TestResult;
}
