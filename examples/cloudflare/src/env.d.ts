import "pracht";

declare module "pracht" {
  interface Register {
    context: {
      env: Env;
      executionContext: ExecutionContext;
    };
  }
}
