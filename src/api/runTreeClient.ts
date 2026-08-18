import {
  parseRunTree,
  type RunTree,
} from "../experiment/runTree";

async function parseJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Run-tree API returned non-JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Run-tree API error (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getRunTree(): Promise<RunTree> {
  const response = await fetch("/api/run-tree");
  const body = await parseJson<{ tree: unknown }>(response);
  return parseRunTree(body.tree);
}

export async function putRunTree(tree: RunTree): Promise<RunTree> {
  const response = await fetch("/api/run-tree", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tree }),
  });
  const body = await parseJson<{ tree: unknown }>(response);
  return parseRunTree(body.tree);
}
