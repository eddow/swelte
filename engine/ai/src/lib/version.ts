// Browser-safe package version. src/lib ships to browsers (client bundle)
// and to the SSR sidecar / QJS render bundle, so it must never import
// node: builtins like node:module/createRequire. Keep in sync with the
// package.json version until the release tooling injects it.
export const VERSION: string = '0.2.0'
