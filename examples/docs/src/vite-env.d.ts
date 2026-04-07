declare module "*.md" {
  const mod: Record<string, unknown>;
  export default mod;
  export const Component: import("preact").FunctionComponent;
}

declare module "*.mdx" {
  const mod: Record<string, unknown>;
  export default mod;
  export const Component: import("preact").FunctionComponent;
}
