import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const version = process.env.npm_package_version;

export default {
  packagerConfig: {
    asar: true,
    icon: "assets/icon", // base name; electron-packager will use .icns/.ico/.png depending on platform
    overwrite: true, // overwrite existing packaged apps
  },
  rebuildConfig: {},
  makers: [
    // {
    //   name: "@electron-forge/maker-zip",
    //   platforms: ["darwin"],
    //   config: {
    //     name: `petro-image-${version}`,
    //   },
    // },
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
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
