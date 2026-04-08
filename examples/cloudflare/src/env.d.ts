import "@pracht/core";

declare module "@pracht/core" {
  interface Register {
    context: {
      env: Env;
      executionContext: ExecutionContext;
    };
  }
}
