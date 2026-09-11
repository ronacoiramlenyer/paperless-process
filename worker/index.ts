import { Hono } from "hono";
import { documentsRoute } from "./routes/documents";
import { signRoute } from "./routes/sign";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/documents", documentsRoute);
app.route("/api/sign", signRoute);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
