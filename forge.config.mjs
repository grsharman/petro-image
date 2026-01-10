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
    // Installer for Windows using NSIS (in progress)
    // {
    //   name: "@electron-forge/maker-nsis",
    //   platforms: ["win32"],
    //   config: {
    //     // Installer metadata
    //     name: "petro-image", // The name of your app
    //     authors: "Sharman, G.R., Sharman, J.P.", // Appears in installer metadata
    //     exe: "petro-image.exe", // Name of the generated executable
    //     description: "petro-image app for Windows",

    //     // Icons
    //     setupIcon: "assets/icon.ico", // Icon for the installer
    //     icon: "assets/icon.ico", // Icon for the installed app and shortcuts

    //     // Installer behavior
    //     oneClick: false, // false = user sees "Next/Back" pages
    //     perMachine: false, // false = installs for current user only
    //     allowElevation: true, // Allow admin permissions if needed
    //     allowToChangeInstallationDirectory: true, // Let user choose install folder
    //     runAfterFinish: true, // Run app after install finishes

    //     // Shortcuts
    //     shortcutName: "petro-image", // Name of Start Menu / desktop shortcuts
    //     shortcutDir: "Desktop", // Can be "Desktop", "StartMenu", or both
    //   },
    // },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {
        name: `petro-image-${version}`,
      },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          icon: "assets/icon.png",
          categories: ["Utility", "Education"],
          packageName: `petro-image-${version}`,
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          icon: "assets/icon.png",
          categories: ["Utility", "Education"],
          packageName: `petro-image-${version}`,
        },
      },
    },
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
