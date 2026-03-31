import type { JsonRpcRequest, JsonRpcResponse } from "@my-easy-claw/shared";

/**
 * Node → Rust 通信桥接层
 *
 * 通过 localhost HTTP + JSON-RPC 2.0 调用 Rust 端暴露的内部 API。
 * 当 Rust HTTP server 未配置时，降级为 noop 模式（开发调试用）。
 */
export interface RustBridge {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  isAvailable(): boolean;
}

export function createRustBridge(baseUrl: string | null): RustBridge {
  if (!baseUrl) {
    return createNoopBridge();
  }

  let requestId = 0;

  return {
    async call<T = unknown>(method: string, params?: unknown): Promise<T> {
      const id = ++requestId;
      const body: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const res = await fetch(`${baseUrl}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(
          `Rust bridge HTTP error: ${res.status} ${res.statusText}`,
        );
      }

      const json: JsonRpcResponse<T> = await res.json();

      if (json.error) {
        const err = new Error(json.error.message);
        (err as any).code = json.error.code;
        (err as any).data = json.error.data;
        throw err;
      }

      return json.result as T;
    },

    isAvailable: () => true,
  };
}

function createNoopBridge(): RustBridge {
  return {
    async call(method: string) {
      console.warn(
        `[RustBridge:noop] Called "${method}" but no Rust HTTP server configured`,
      );
      return null as any;
    },
    isAvailable: () => false,
  };
}
