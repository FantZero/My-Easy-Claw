/**
 * Sidecar 构建脚本
 *
 * 使用 esbuild 将 TypeScript 源码打包为单文件 ESM，
 * 然后复制到 src-tauri/binaries/ 目录，运行时由系统 Node.js 执行。
 */

import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const binariesDir = resolve(rootDir, "src-tauri/binaries");
const buildDir = resolve(__dirname, "build");

function run(command, cwd = __dirname) {
  execSync(command, { cwd, stdio: "inherit" });
}

async function build() {
  console.log("Building sidecar (esbuild bundle)...");

  if (!existsSync(binariesDir)) {
    mkdirSync(binariesDir, { recursive: true });
  }

  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  run("pnpm --filter @my-easy-claw/shared build", rootDir);

  await esbuild.build({
    entryPoints: [resolve(__dirname, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: resolve(buildDir, "sidecar.mjs"),
    banner: {
      js: `import { createRequire as __createRequire__ } from "node:module"; const require = __createRequire__(import.meta.url);`,
    },
  });

  cpSync(resolve(buildDir, "sidecar.mjs"), resolve(binariesDir, "sidecar.mjs"));

  console.log(`Sidecar bundle copied to: src-tauri/binaries/sidecar.mjs`);
}

build();
