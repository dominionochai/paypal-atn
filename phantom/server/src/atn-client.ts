/**
 * Narrow server-side client for the ATN API.
 *
 * Route paths are client-side assumptions until the ATN backend routes are implemented.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RequestAuthorityInput {
  agentId: string;
  scope: string;
  ceiling: number;
  ttlSeconds: number;
}

export interface RequestAuthorityResponse {
  delegationId: string;
  expiresAt: string;
  ceiling: number;
}

export interface SpendInput {
  delegationId: string;
  amount: number;
  idempotencyKey: string;
}

export interface SpendResponse {
  ok: boolean;
  code?: string;
  receiptRef?: string;
}

export interface SubmitArtifactInput {
  escrowId: string;
  bytes: Uint8Array;
  metadata: Record<string, JsonValue>;
}

/**
 * Provisional minimal response contract for submitArtifact. No backend response
 * schema is defined yet; this client currently expects an { ok: boolean } JSON body.
 */
export interface SubmitArtifactResponse {
  ok: boolean;
}

export interface CheckEscrowInput {
  escrowId: string;
}

export interface CheckEscrowResponse {
  status: string;
  verdict: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestAuthorityResponse(value: unknown): RequestAuthorityResponse {
  if (
    !isRecord(value) ||
    typeof value.delegationId !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.ceiling !== "number"
  ) {
    throw new TypeError("Invalid ATN requestAuthority response");
  }

  return {
    delegationId: value.delegationId,
    expiresAt: value.expiresAt,
    ceiling: value.ceiling,
  };
}

function parseSpendResponse(value: unknown): SpendResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new TypeError("Invalid ATN spend response");
  }

  const response: SpendResponse = { ok: value.ok };
  if (value.code !== undefined) {
    if (typeof value.code !== "string") {
      throw new TypeError("Invalid ATN spend response: code must be a string");
    }
    response.code = value.code;
  }
  if (value.receiptRef !== undefined) {
    if (typeof value.receiptRef !== "string") {
      throw new TypeError("Invalid ATN spend response: receiptRef must be a string");
    }
    response.receiptRef = value.receiptRef;
  }

  return response;
}

function parseSubmitArtifactResponse(value: unknown): SubmitArtifactResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new TypeError("Invalid ATN submitArtifact response");
  }

  return { ok: value.ok };
}

function parseCheckEscrowResponse(value: unknown): CheckEscrowResponse {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    typeof value.verdict !== "string"
  ) {
    throw new TypeError("Invalid ATN checkEscrow response");
  }

  return { status: value.status, verdict: value.verdict };
}

export class AtnClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: URL;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    const configuredBaseUrl = process.env.ATN_BASE_URL;
    if (!configuredBaseUrl) {
      throw new Error("ATN_BASE_URL must be set to use the ATN client");
    }

    this.baseUrl = new URL(
      configuredBaseUrl.endsWith("/") ? configuredBaseUrl : `${configuredBaseUrl}/`,
    );
    this.fetchImpl = fetchImpl;
  }

  requestAuthority(input: RequestAuthorityInput): Promise<RequestAuthorityResponse> {
    return this.request(
      "authority/request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      parseRequestAuthorityResponse,
    );
  }

  spend(input: SpendInput): Promise<SpendResponse> {
    return this.request(
      "spend",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      parseSpendResponse,
    );
  }

  submitArtifact(input: SubmitArtifactInput): Promise<SubmitArtifactResponse> {
    const body = {
      escrowId: input.escrowId,
      bytes: Buffer.from(input.bytes).toString("base64"),
      bytesEncoding: "base64",
      metadata: input.metadata,
    };

    return this.request(
      "artifacts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      parseSubmitArtifactResponse,
    );
  }

  checkEscrow(input: CheckEscrowInput): Promise<CheckEscrowResponse> {
    return this.request(
      `escrows/${encodeURIComponent(input.escrowId)}`,
      { method: "GET" },
      parseCheckEscrowResponse,
    );
  }

  private async request<Response>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => Response,
  ): Promise<Response> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), init);
    if (!response.ok) {
      throw new Error(`ATN request failed with HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TypeError("ATN returned invalid JSON");
    }

    return parse(body);
  }
}
