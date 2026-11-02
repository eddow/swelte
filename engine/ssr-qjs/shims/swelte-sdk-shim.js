// `$app/*` / `#app/*` / `#lib/*` server-shaped sources, inlined at bundle
// time (see resolveSdkShim). Kept next to the Rollup shims so bundle
// inputs stay auditable in one dir; header documents the contract.
export const SWELTE_SSR_SDK_SHIM = `// swelte:ssr-qjs $app/* server-shaped shim (sync renderRoute has no router/stores).
export const page = undefined;
export const navigating = undefined;
export const updated = undefined;
export function goto() { throw new Error('[swelte:ssr-qjs] goto() called during SSR render'); }
export function preloadData() { throw new Error('[swelte:ssr-qjs] preloadData() called during SSR render'); }
export function pushState() { throw new Error('[swelte:ssr-qjs] pushState() called during SSR render'); }
export function beforeNavigate() { return () => {}; }
export function afterNavigate() { return () => {}; }
export function onNavigate() { return () => {}; }
`;
export const SWELTE_SSR_ENV_SHIM = `// swelte:ssr-qjs $app/environment server shape (browser=false in SSR).
export const browser = false;
export const dev = true;
export const building = false;
export const version = '';
`;
export const SWELTE_SSR_PATHS_SHIM = `// swelte:ssr-qjs $app/paths server shape (empty base/assets in SSR).
export const base = '';
export const assets = '';
`;
