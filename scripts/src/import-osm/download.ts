export const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";

export const OVERPASS_USER_AGENT =
  "tokyo-area-finder-import-osm/1.0 (https://github.com/tokyo-area-finder/tokyo-area-finder; " +
  "batch import script, one request per run)";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function downloadOverpass(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(OVERPASS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`import:osm — Overpass download failed (${message})`, { cause: err });
  }

  if (response.status === 429) {
    throw new Error(
      "import:osm — Overpass API rate-limited this request (HTTP 429). This script makes only one " +
        "request per run, so retrying immediately will likely be rate-limited again — wait a while " +
        "before re-running, or pass --file with a previously saved Overpass JSON response instead.",
    );
  }
  if (response.status === 504) {
    throw new Error(
      "import:osm — Overpass API timed out (HTTP 504), which usually means the public instance is " +
        "overloaded or this query's bbox is too large for it right now. Retry later, or query a " +
        "mirror (e.g. https://overpass.kumi.systems/api/interpreter) yourself and pass the saved " +
        "response's path via --file.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `import:osm — Overpass download failed (${String(response.status)} ${response.statusText})`,
    );
  }

  return await response.text();
}
