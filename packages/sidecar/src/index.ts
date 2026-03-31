import { createWSServer } from "./ws-server.js";
import { createRustBridge } from "./rust-bridge.js";
import { AgentManager } from "./agent-manager.js";
import { INTERNAL_SERVER_HOST } from "@my-easy-claw/shared";

async function main() {
  const rustHttpPort = parseInt(process.argv[2] || "0", 10);

  const rustBridge = createRustBridge(
    rustHttpPort > 0 ? `http://${INTERNAL_SERVER_HOST}:${rustHttpPort}` : null,
  );

  const agentManager = new AgentManager(rustBridge);

  const wsServer = await createWSServer(agentManager);

  // 通过 stdout 向 Tauri 报告就绪状态和端口号
  const port = wsServer.port;
  console.log(JSON.stringify({ status: "ready", port }));

  process.on("SIGTERM", async () => {
    console.log("Received SIGTERM, shutting down...");
    await agentManager.shutdown();
    wsServer.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Received SIGINT, shutting down...");
    await agentManager.shutdown();
    wsServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Sidecar fatal error:", err);
  process.exit(1);
});
