// Metro for the npm-workspaces monorepo. Expo's default watches the WHOLE workspace root, which here
// includes the backend, the web app, and native build outputs (gigabytes): without watchman the crawler then
// pins a CPU for many minutes. Watch only what the app imports (this app, the shared packages, the
// hoisted node_modules) and never descend into native build output.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [path.join(workspaceRoot, 'packages'), path.join(workspaceRoot, 'node_modules')]

const sep = '[\\\\/]'
const extraBlocks = [
  new RegExp(`${sep}android${sep}(app${sep})?(build|\\.cxx|\\.gradle)${sep}.*`),
  new RegExp(`${sep}ios${sep}(build|Pods)${sep}.*`),
  new RegExp(`${sep}\\.expo${sep}.*`),
]
const prev = config.resolver.blockList
config.resolver.blockList = [...(Array.isArray(prev) ? prev : prev ? [prev] : []), ...extraBlocks]

module.exports = config
