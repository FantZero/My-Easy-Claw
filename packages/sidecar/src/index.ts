import { createWSServer } from "./ws-server.js";
import { AgentManager } from "./agent-manager.js";

async function main() {
  const agentManager = new AgentManager();

  const wsServer = await createWSServer(agentManager);

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
