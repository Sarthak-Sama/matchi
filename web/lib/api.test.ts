import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, getJson, postJson } from "./api";

describe("web/lib/api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed JSON body on a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ stationGroupId: "sg-shibuya" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await getJson<{ results: unknown[] }>("/v1/stations?query=shi&limit=8");

    expect(data).toEqual({ results: [{ stationGroupId: "sg-shibuya" }] });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/stations?query=shi&limit=8"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws an ApiClientError surfacing the API's code and message on a 400", async () => {
    const errorBody = {
      error: { code: "VALIDATION_ERROR", message: "Request validation failed" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(postJson("/v1/optimize", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
    });
  });

  it("throws an ApiClientError when the network request itself fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJson("/v1/data-status")).rejects.toBeInstanceOf(ApiClientError);
    await expect(getJson("/v1/data-status")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
