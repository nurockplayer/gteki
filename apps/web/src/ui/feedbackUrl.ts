/** Only game routing parameters belong in feedback; never copy fragments or unrelated queries. */
export function feedbackUrl(raw: string): string {
  const source = new URL(raw);
  const url = new URL(source.origin + source.pathname);
  for (const key of ["station", "from", "to", "lang", "next"]) {
    const value = source.searchParams.get(key);
    if (value !== null && (key !== "next" || value === "1")) url.searchParams.set(key, value);
  }
  return url.href;
}
