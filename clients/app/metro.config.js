const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

// Metro config for the bun-workspace monorepo. M20 Decision 4:
//   - watchFolders: workspace root so Metro can resolve @voix/ui +
//     @voix/protocol via their symlinks under node_modules/.
//   - nodeModulesPaths: leaf-first (clients/app/node_modules), then
//     workspace root (.../node_modules).
//   - extraNodeModules Proxy: forces leaf-first lookup. Without it,
//     Bun's hoist can produce "two copies of React" at runtime when
//     @voix/ui resolves its own react alongside the leaf's.

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const defaultConfig = getDefaultConfig(projectRoot);

const config = {
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    extraNodeModules: new Proxy(
      {},
      { get: (_t, name) => path.join(projectRoot, "node_modules", name) }
    ),
  },
};

module.exports = mergeConfig(defaultConfig, config);
