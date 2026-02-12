import { Hono } from "hono";
import { cors } from "hono/cors";
import router from "./routes/router";

const app = new Hono();

app.use(cors());

app.route("/api", router);

export default {
  port: 3000,
  fetch: app.fetch,
};
