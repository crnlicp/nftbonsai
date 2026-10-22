import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const environment = process.env.ICP_CLI_ENVIRONMENT;
if (!environment) throw new Error("Run auth-callbacks through icp sync or deploy.");
const callbacks = [];
if (environment === "local") {
  const frontend = process.env.ICP_CLI_CID_FRONTEND;
  if (!frontend) throw new Error("The frontend canister must exist before generating auth callbacks.");
  const cli = fileURLToPath(new URL("../node_modules/.bin/icp", import.meta.url));
  const status = JSON.parse(execFileSync(cli, ["network", "status", "-e", environment, "--json"], { encoding: "utf8" }));
  for (const hostname of [`frontend.${environment}.localhost`, `${frontend}.localhost`]) {
    const callback = new URL("/auth", status.gateway_url);
    callback.hostname = hostname;
    callbacks.push(callback.href);
  }
  callbacks.push("http://localhost:5173/auth");
}
await writeFile(
  new URL("../frontend/dist/.well-known/ii-auth-callbacks", import.meta.url),
  `${JSON.stringify({ callbacks }, null, 2)}\n`,
);
