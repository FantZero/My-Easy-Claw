/**
 * Sidecar 构建脚本
 *
 * 使用 pkg 将 Node.js 应用编译为独立可执行文件，
 * 然后复制到 src-tauri/binaries/ 目录。
 *
 * 目标命名格式：sidecar-<target-triple>[.exe]
 */

import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const binariesDir = resolve(rootDir, "src-tauri/binaries");

function getTargetTriple() {
  try {
    return execSync("rustc --print host-tuple", { encoding: "utf-8" }).trim();
  } catch {
    const platform = process.platform;
    const arch = process.arch === "x64" ? "x86_64" : process.arch;
    if (platform === "win32") return `${arch}-pc-windows-msvc`;
    if (platform === "darwin") return `${arch}-apple-darwin`;
    return `${arch}-unknown-linux-gnu`;
  }
}

function build() {
  const triple = getTargetTriple();
  const ext = process.platform === "win32" ? ".exe" : "";
  const outName = `sidecar-${triple}${ext}`;

  console.log(`Building sidecar for target: ${triple}`);

  if (!existsSync(binariesDir)) {
    mkdirSync(binariesDir, { recursive: true });
  }

  // 先用 esbuild 打包为单文件
  execSync(
    `npx esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=build/sidecar.cjs --format=cjs`,
    { cwd: __dirname, stdio: "inherit" },
  );

  // 用 pkg 编译为独立可执行文件
  execSync(
    `npx pkg build/sidecar.cjs --target node22-win-x64 --output build/${outName}`,
    { cwd: __dirname, stdio: "inherit" },
  );

  cpSync(
    resolve(__dirname, `build/${outName}`),
    resolve(binariesDir, outName),
  );

  console.log(`Sidecar binary copied to: src-tauri/binaries/${outName}`);
}

build();
