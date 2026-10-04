import type { Naming } from "./types.ts";

/** The ONLY way a SQL alias is produced: z_ + UPPERCASE(name). See schema/_conventions.yaml. */
export function aliasOf(name: string): string {
  return "z_" + name.toUpperCase();
}

/** The name that counts for uniqueness checks (approved or proposed). */
export function nameOf(n: Naming): string | undefined {
  return n.name_status === "approved" ? n.name : n.name_status === "proposed" ? n.proposed_name : undefined;
}
