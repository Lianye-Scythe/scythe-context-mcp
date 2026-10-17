import { PACKAGE_VERSION, parseCliArgs, renderHelp } from "./cli.js";

export async function main(args: string[], defaultKind: "serve" | "help"): Promise<number> {
  const command = parseCliArgs(args, defaultKind);
  if (command.kind === "help") { console.log(renderHelp(command.command)); return 0; }
  if (command.kind === "version") { console.log(PACKAGE_VERSION); return 0; }
  if (command.kind === "error") {
    console.error(command.message);
    console.error("Run `scythe-context --help` for usage.");
    return 1;
  }
  try {
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    if (command.kind === "operation") {
      const { runCliOperation } = await import("./cliRunner.js");
      const result = await runCliOperation(command, config);
      console.log(result.text);
      return result.exitCode;
    }
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer(config);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(command.kind === "operation" && command.json ? JSON.stringify({ status: "error", message }) : message);
    return 1;
  }
}
