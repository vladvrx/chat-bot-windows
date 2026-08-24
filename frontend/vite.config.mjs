// Node 26 can load the typed configuration natively. This JavaScript entry
// avoids Vite's transient config bundle, which is unreliable on Windows
// workspaces with inherited directory permissions.
export { default } from "./vite.config.ts";
