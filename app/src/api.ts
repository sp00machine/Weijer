// Type-only import from the server workspace — erased at build, so no runtime coupling.
import type { ResolveRequest, ResolveResponse } from "../../server/types.ts";

export type { AisleResult, ResolveResponse, ScraperStatus } from "../../server/types.ts";

export async function resolve(store: string, urls: string[]): Promise<ResolveResponse> {
  const body: ResolveRequest = { store, urls };
  const res = await fetch("/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`server error ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as ResolveResponse;
}
