import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { icpBindgen } from "@icp-sdk/bindgen/plugins/vite";

const icp = fileURLToPath(new URL("../backend/node_modules/.bin/icp", import.meta.url));

function devServer() {
  const environment = process.env.ICP_ENVIRONMENT || "local";
  const status: { api_url: string; root_key: string; gateway_url: string } = JSON.parse(
    execFileSync(icp, ["network", "status", "-e", environment, "--json"], { encoding: "utf8" }),
  );
  const params = new URLSearchParams({ ic_root_key: status.root_key });
  for (const name of ["backend", "icrc7"]) {
    const id = execFileSync(icp, ["canister", "status", name, "-e", environment, "--id-only"], { encoding: "utf8" }).trim();
    params.set(`PUBLIC_CANISTER_ID:${name}`, id);
    if (name === "icrc7") {
      const gateway = new URL(status.gateway_url);
      gateway.hostname = `${id}.localhost`;
      params.set("PUBLIC_NFT_IMAGE_ORIGIN", gateway.origin);
    }
  }
  try {
    // Local-only preview canister behind /art-lab; absent from other environments.
    params.set("PUBLIC_CANISTER_ID:art-lab", execFileSync(icp, ["canister", "status", "art-lab", "-e", environment, "--id-only"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    // Not deployed here.
  }
  const cookie = Array.from(params, ([key, value]) => `${key}=${value}`).join("&");
  return {
    port: 5173,
    strictPort: true,
    headers: { "Set-Cookie": `ic_env=${encodeURIComponent(cookie)}; Path=/; SameSite=Lax` },
    proxy: { "/api": { target: status.api_url, changeOrigin: true } },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "ii-development-metadata",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split("?")[0];
          if (path !== "/.well-known/ii-app-metadata") {
            next();
            return;
          }
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.end(readFileSync(new URL(`./public${path}`, import.meta.url)));
        });
      },
    },
    icpBindgen({ didFile: "../backend/backend.did", outDir: "./src/bindings" }),
    icpBindgen({ didFile: "../backend/icrc7.did", outDir: "./src/bindings" }),
  ],
  ...(command === "serve" ? { server: devServer() } : {}),
  build: { outDir: "dist", emptyOutDir: true },
}));
