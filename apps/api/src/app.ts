import Fastify from "fastify";

export const buildApp = () => {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "resend-mailbox-api",
  }));

  return app;
};
