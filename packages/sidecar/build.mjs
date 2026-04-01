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
const buildDir = resolve(__dirname, "build");

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

function getPkgTarget() {
  const nodeTarget = process.env.SIDECAR_PKG_NODE_TARGET ?? "node18";
  const platformMap = {
    win32: "win",
    darwin: "macos",
    linux: "linux",
  };
  const archMap = {
    x64: "x64",
    arm64: "arm64",
  };

  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];

  if (!platform || !arch) {
    throw new Error(
      `Unsupported pkg target platform/arch: ${process.platform}/${process.arch}`,
    );
  }

  return `${nodeTarget}-${platform}-${arch}`;
}

function run(command, cwd = __dirname) {
  execSync(command, { cwd, stdio: "inherit" });
}

function build() {
  const triple = getTargetTriple();
  const ext = process.platform === "win32" ? ".exe" : "";
  const outName = `sidecar-${triple}${ext}`;
  const pkgTarget = getPkgTarget();

  console.log(`Building sidecar for target: ${triple}`);

  if (!existsSync(binariesDir)) {
    mkdirSync(binariesDir, { recursive: true });
  }

  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  // shared 包通过 exports 指向 dist，sidecar 单独构建时要先确保它已产出。
  run("pnpm --filter @my-easy-claw/shared build", rootDir);

  // 先用 esbuild 打包为单文件
  run(
    "pnpm exec esbuild src/index.ts --bundle --platform=node --target=node18 --outfile=build/sidecar.cjs --format=cjs",
  );

  // 用 pkg 编译为独立可执行文件
  run(
    `pnpm exec pkg build/sidecar.cjs --target ${pkgTarget} --output build/${outName}`,
  );

  cpSync(
    resolve(buildDir, outName),
    resolve(binariesDir, outName),
  );

  console.log(`Sidecar binary copied to: src-tauri/binaries/${outName}`);
}

build();
