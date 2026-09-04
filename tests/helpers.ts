import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore, setStore } from "@probes/core/store/index.ts";

/**
 * Point the shared store at a throwaway directory for the duration of a test
 * file, so tests never read or write the repo's real `.data`.
 */
export function useTempStore(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "probe-test-"));
  setStore(new FileStore(dir));
  return {
    dir,
    cleanup: () => {
      setStore(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Build a multipart request the way the browser does, for route-level tests. */
export function formRequest(
  url: string,
  fields: Record<string, string>,
  file?: { name: string; content: string | Uint8Array; type?: string },
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) {
    const bytes =
      typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    form.append(
      "file",
      new File([bytes as BlobPart], file.name, { type: file.type ?? "text/plain" }),
    );
  }
  return new Request(url, { method: "POST", body: form });
}

export function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
