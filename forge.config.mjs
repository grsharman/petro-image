import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const version = process.env.npm_package_version;

export default {
  packagerConfig: {
    asar: {
      unpackDir: "node_modules/{sharp,@img}",
    },
    appBundleId: "com.sharman.petro-image",
    icon: "assets/icon", // base name; electron-packager will use .icns/.ico/.png depending on platform
    overwrite: true, // overwrite existing packaged apps
    osxSign: {},
    extraResource: ["build/czi-worker", "build/vips-worker", "tutorial-assets"],
    ignore: [
      /^\/\.venv-czi-build(?:\/|$)/,
      /^\/build\/czi-worker(?:-cache|-spec|-work)?(?:\/|$)/,
      /^\/build\/vips-worker(?:\/|$)/,
      /^\/\.vips-worker-build(?:\/|$)/,
      /^\/test-data(?:\/|$)/,
      /^\/tutorial-assets(?:\/|$)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {
        name: `petro-image-${version}`,
      },
    },
    // {
    //   name: "@electron-forge/maker-deb",
    //   platforms: ["linux"],
    //   config: {
    //     options: {
    //       icon: "assets/icon.png",
    //       categories: ["Utility", "Education"],
    //       packageName: `petro-image-${version}`,
    //     },
    //   },
    // },
    // {
    //   name: "@electron-forge/maker-rpm",
    //   platforms: ["linux"],
    //   config: {
    //     options: {
    //       icon: "assets/icon.png",
    //       categories: ["Utility", "Education"],
    //       packageName: `petro-image-${version}`,
    //     },
    //   },
    // },
  ],
  hooks: {
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== "darwin") return;
      const identity = process.env.PETRO_IMAGE_MAC_SIGN_IDENTITY || "-";
      for (const outputPath of outputPaths) {
        const appPath = outputPath.endsWith(".app")
          ? outputPath
          : fs
              .readdirSync(outputPath)
              .filter((name) => name.endsWith(".app"))
              .map((name) => path.join(outputPath, name))[0];
        if (!appPath) throw new Error(`Packaged macOS app not found in ${outputPath}`);
        const signArguments =
          identity === "-"
            ? ["--force", "--deep", "--sign", identity, "--timestamp=none"]
            : [
                "--force",
                "--deep",
                "--options",
                "runtime",
                "--timestamp",
                "--sign",
                identity,
              ];
        execFileSync(
          "codesign",
          [...signArguments, appPath],
          { stdio: "inherit" },
        );
      }
    },
  },
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
