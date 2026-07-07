import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@vercel/blob", () => ({ put: vi.fn().mockResolvedValue({ url: "https://blob.example/scan.jpg" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: vi.fn() },
    opnameSession: { findUnique: vi.fn() },
  },
}));

import { POST } from "./route";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const getSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const settingFind = prisma.systemSetting.findUnique as unknown as ReturnType<typeof vi.fn>;
const sessionFind = prisma.opnameSession.findUnique as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function fakeReq() {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "page1.jpg", { type: "image/jpeg" }));
  return { formData: async () => fd } as unknown as Request;
}
const ctx = { params: Promise.resolve({ id: "sess1" }) };

const twoLineSession = {
  status: "IN_PROGRESS",
  lines: [
    { id: "line-a", product: { sku: "SKU-A", name: "Batok 18 2L", unit: { name: "pcs" } } },
    { id: "line-b", product: { sku: "SKU-B", name: "Minyak 1L", unit: { name: "btl" } } },
  ],
};

function mockModelResponse(body: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { role: "ADMIN" } });
  settingFind.mockResolvedValue({ value: "1" });
  sessionFind.mockResolvedValue(twoLineSession);
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

describe("POST /api/opname/[id]/scan — guards", () => {
  it("403 for non-admin", async () => {
    getSession.mockResolvedValue({ user: { role: "STAFF" } });
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it("401 when unauthenticated", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when the feature flag is off", async () => {
    settingFind.mockResolvedValue({ value: "0" });
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it("503 when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(503);
  });

  it("409 when the session is not open for counting", async () => {
    sessionFind.mockResolvedValue({ ...twoLineSession, status: "REVIEWING" });
    mockModelResponse({});
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/opname/[id]/scan — happy path", () => {
  it("maps a well-formed model response onto line ids and returns apply/unclear", async () => {
    mockModelResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({
        page: 1,
        rows: [
          { row: 1, qty: 24, unclear: false },
          { row: 2, qty: null, unclear: true },
        ],
      }) }],
    });

    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.page).toBe(1);
    expect(data.filledCount).toBe(1);
    expect(data.unclearCount).toBe(1);
    expect(data.apply).toEqual([{ lineId: "line-a", sku: "SKU-A", name: "Batok 18 2L", qty: 24 }]);
    expect(data.unclear).toEqual([{ lineId: "line-b", sku: "SKU-B", name: "Minyak 1L", reason: "unclear" }]);
    expect(data.photoUrl).toBe("https://blob.example/scan.jpg");
    expect(data.totalRows).toBe(2);
  });

  it("sends a well-formed request to the Claude API (model, image, schema)", async () => {
    mockModelResponse({ content: [{ type: "text", text: JSON.stringify({ page: 1, rows: [] }) }] });
    await POST(fakeReq(), ctx);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("sk-test");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");

    const sent = JSON.parse(opts.body);
    expect(sent.model).toBe("claude-opus-4-8");
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.output_config.format.schema.required).toContain("rows");
    // image block carries base64 data + a text block with the expected-row catalog
    const content = sent.messages[0].content;
    const img = content.find((b: { type: string }) => b.type === "image");
    const txt = content.find((b: { type: string }) => b.type === "text");
    expect(img.source.type).toBe("base64");
    expect(img.source.media_type).toBe("image/jpeg");
    expect(typeof img.source.data).toBe("string");
    expect(txt.text).toContain("[SKU-A] Batok 18 2L");
  });
});

describe("POST /api/opname/[id]/scan — failures", () => {
  it("502 when the model refuses", async () => {
    mockModelResponse({ stop_reason: "refusal", content: [] });
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(502);
  });

  it("502 on an API error (non-ok response)", async () => {
    mockModelResponse({ error: "boom" }, false, 500);
    const res = await POST(fakeReq(), ctx);
    expect(res.status).toBe(502);
  });

  it("400 for a non-image upload", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1])], "notes.pdf", { type: "application/pdf" }));
    const req = { formData: async () => fd } as unknown as Request;
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });
});
