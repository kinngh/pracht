declare module "virtual:viact/server" {
  const mod: { fetch: (request: Request, env: any, ctx: any) => Promise<Response> };
  export default mod;
}

declare module "virtual:viact/client" {}
