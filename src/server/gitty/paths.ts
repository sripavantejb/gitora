import type { RepositoryPathType } from "~/server/generate/github";
import { isSensitivePath } from "~/server/generate/repository-context";

export type PathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * A repository-relative path as given by a caller or the model, normalized and
 * checked against the repository's own listing. Nothing outside the listing,
 * nothing that climbs out of it and no secret-bearing file passes.
 */
export function checkRepositoryPath(
  raw: unknown,
  pathTypes: ReadonlyMap<string, RepositoryPathType>,
  expected: RepositoryPathType | "any" = "blob",
): PathCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Path must be a string." };
  const trimmed = raw.trim().replace(/^\.\/+/, "");
  if (!trimmed || trimmed.length > 500)
    return { ok: false, reason: "Path is empty or too long." };
  if (
    trimmed.includes("\0") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/") ||
    /^[a-z]+:/i.test(trimmed) ||
    trimmed.split("/").some((segment) => segment === ".." || segment === ".")
  )
    return { ok: false, reason: "Path must be relative to the repository root." };
  const path = trimmed.replace(/\/+$/, "");
  if (isSensitivePath(path))
    return { ok: false, reason: "That file may contain secrets and is never read." };
  const type = pathTypes.get(path);
  if (!type) return { ok: false, reason: `No such path in the repository: ${path}` };
  if (expected !== "any" && type !== expected)
    return {
      ok: false,
      reason: expected === "blob" ? `${path} is a directory.` : `${path} is a file.`,
    };
  return { ok: true, path };
}
