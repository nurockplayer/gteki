import type { Tenant } from "@gteki/schema";
import type { SearchHit } from "@gteki/search";
import { pick, type Lang, type Strings } from "../i18n.ts";

/**
 * A store's printed brand directory (#419) is shown as a fact about the store, never as its own place:
 * the card keeps the store's name and route, and says which brand and which printed floor it refers to.
 */

/** The brand and floor strings in the reader's language (ja, then the first entry). */
export function tenantLabel(tenant: Tenant, lang: Lang): { name: string; floorLabel: string } {
  return { name: pick(tenant.names, lang), floorLabel: pick(tenant.floorLabel, lang) };
}

/** The floor label exactly as printed; English says so, because it is not a station floor. */
export function printedFloor(label: string, lang: Lang, t: Strings): string {
  return lang === "en" ? `${label} ${t.asPrinted}` : label;
}

/** Result-row meta tags for a hit that matched a tenant ("8F · “brand” (+N)"). */
export function tenantResultTags(hit: Pick<SearchHit, "tenant" | "moreTenants">, lang: Lang, t: Strings): string[] {
  const tenant = hit.tenant;
  if (!tenant) return [];
  const more = hit.moreTenants && hit.moreTenants > 0 ? ` (+${hit.moreTenants})` : "";
  return [printedFloor(tenant.floorLabel, lang, t), `“${tenant.name}”${more}`];
}

/** The directory's check date for a tenant, or null when the loaded bundle no longer lists it. */
export function tenantCheckedDate(tenants: Tenant[] | undefined, id: string): string | null {
  return tenants?.find((t) => t.id === id)?.evidence.checkedDate ?? null;
}

/** The destination title when the destination was picked through a tenant: "Store — Brand（8F）". */
export function tenantDestinationTitle(
  storeName: string,
  tenant: { name: string; floorLabel: string },
  lang: Lang,
  t: Strings,
): string {
  return lang === "en"
    ? `${storeName} — ${tenant.name} (${tenant.floorLabel}) ${t.asPrinted}`
    : `${storeName} — ${tenant.name}（${tenant.floorLabel}）`;
}
