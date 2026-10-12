// Metro config for the CheqPay mobile app inside the bun workspace monorepo.
// Lets Metro find packages hoisted to the repo-root node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so shared packages reload.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// The app's own `import ... from 'react-native'` gets lib/typeface.js, which is
// react-native with Text/TextInput set in CheqPay's typeface (see that file).
// Libraries in node_modules, and the typeface files themselves, get the real module.
const typeface = path.resolve(projectRoot, "lib/typeface.js");
const appCode = (from) =>
  from.startsWith(projectRoot + path.sep) &&
  !from.includes(`${path.sep}node_modules${path.sep}`) &&
  !from.startsWith(path.resolve(projectRoot, "lib/typeface"));
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const from = context.originModulePath;
  if (appCode(from)) {
    if (moduleName === "react-native") return { type: "sourceFile", filePath: typeface };
    // On web, babel rewrites `import { Text } from 'react-native'` to the
    // react-native-web export module, which would skip typeface.js.
    const web = /^react-native-web\/dist\/(?:cjs\/)?exports\/(Text|TextInput)(?:\/index(?:\.js)?)?$/.exec(moduleName);
    if (web) return { type: "sourceFile", filePath: path.resolve(projectRoot, `lib/typeface.${web[1]}.js`) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
