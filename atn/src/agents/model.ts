export interface ToolParameter {
  type: string;
  description: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, ToolParameter>; required: string[] };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'model'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; result: unknown };

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
}

export interface ModelClient {
  readonly label: string;
  readonly live: boolean;
  generate(system: string, messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<ModelReply>;
}

let callCounter = 0;

export function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  callCounter += 1;
  return { id: 'call_' + String(callCounter), name, args };
}

export function calls(...toolCalls: ToolCall[]): ModelReply {
  return { text: '', toolCalls };
}

export function say(text: string): ModelReply {
  return { text, toolCalls: [] };
}

export type ScriptStep = (messages: readonly ChatMessage[]) => ModelReply;

/** Deterministic, offline stand-in for an LLM. Each generate() call runs the next scripted step. */
export class ScriptedModel implements ModelClient {
  readonly label = 'MOCK MODEL (scripted, deterministic)';
  readonly live = false;
  private index = 0;

  constructor(private readonly steps: readonly ScriptStep[]) {}

  async generate(_system: string, messages: readonly ChatMessage[], _tools: readonly ToolSpec[]): Promise<ModelReply> {
    const step = this.steps[this.index];
    this.index += 1;
    return step === undefined ? say('Task complete.') : step(messages);
  }
}

/** Finds the most recent tool result for a tool name (used by scripted steps that react to tool output). */
export function lastToolResult(messages: readonly ChatMessage[], name: string): unknown {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== undefined && message.role === 'tool' && message.name === name) return message.result;
  }
  return undefined;
}

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiConfigError';
  }
}

export interface GeminiOptions {
  apiKey: string | undefined;
  model: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
  tools: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: ToolSpec['parameters'] }> }>;
  generationConfig: { temperature: number };
}

/** Builds the generateContent request body. Consecutive tool results become one user turn with several functionResponse parts. */
export function buildGeminiRequest(system: string, messages: readonly ChatMessage[], tools: readonly ToolSpec[]): GeminiRequestBody {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.text }] });
    } else if (message.role === 'model') {
      const parts: GeminiPart[] = [];
      if (message.text.length > 0) parts.push({ text: message.text });
      for (const toolCall of message.toolCalls) parts.push({ functionCall: { name: toolCall.name, args: toolCall.args } });
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else {
      const part: GeminiPart = { functionResponse: { name: message.name, response: { result: message.result } } };
      const previous = contents[contents.length - 1];
      if (previous !== undefined && previous.role === 'user' && previous.parts.every((p) => p.functionResponse !== undefined)) {
        previous.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
    }
  }
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    generationConfig: { temperature: 0 },
  };
}

interface GeminiResponseBody {
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>;
  promptFeedback?: { blockReason?: string };
}

export function parseGeminiReply(body: GeminiResponseBody): ModelReply {
  const candidate = body.candidates?.[0];
  if (candidate === undefined) {
    const reason = body.promptFeedback?.blockReason;
    throw new Error('Gemini returned no candidates' + (reason !== undefined ? ' (blocked: ' + reason + ')' : ''));
  }
  const parts = candidate.content?.parts ?? [];
  let text = '';
  const toolCalls: ToolCall[] = [];
  parts.forEach((part, index) => {
    if (typeof part.text === 'string') text += part.text;
    if (part.functionCall !== undefined) {
      toolCalls.push({ id: 'gemini_' + String(index) + '_' + part.functionCall.name, name: part.functionCall.name, args: part.functionCall.args ?? {} });
    }
  });
  return { text, toolCalls };
}

function redact(text: string, secret: string): string {
  return secret.length === 0 ? text : text.split(secret).join('[redacted]');
}

/** Live Gemini client over the REST API. Requires GEMINI_API_KEY and an explicit model id (no default is assumed). */
export class GeminiClient implements ModelClient {
  readonly label: string;
  readonly live = true;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: GeminiOptions) {
    const key = options.apiKey ?? '';
    if (key.length === 0 || key.startsWith('mock-')) {
      throw new GeminiConfigError('GEMINI_API_KEY is missing or a mock value. Put your real key in atn/.env, or run with --mock.');
    }
    const model = options.model ?? '';
    if (model.length === 0) {
      throw new GeminiConfigError('GEMINI_MODEL is empty. Set the exact model id from Google AI Studio in atn/.env, or run with --mock.');
    }
    this.apiKey = key;
    this.model = model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com';
    this.label = 'LIVE: Gemini ' + model;
  }

  async generate(system: string, messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<ModelReply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl + '/v1beta/models/' + encodeURIComponent(this.model) + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(buildGeminiRequest(system, messages, tools)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = redact(await response.text(), this.apiKey).slice(0, 500);
        throw new Error('Gemini request failed (HTTP ' + String(response.status) + '): ' + detail);
      }
      return parseGeminiReply((await response.json()) as GeminiResponseBody);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Gemini request timed out after ' + String(this.timeoutMs) + ' ms');
      }
      throw error instanceof Error ? new Error(redact(error.message, this.apiKey)) : error;
    } finally {
      clearTimeout(timer);
    }
  }
}
