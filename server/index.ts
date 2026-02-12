import { Hono } from "hono";
import { cors } from "hono/cors";
import admin from "./routes/admin";
import activate from "./routes/activate";
import keys from "./routes/keys";
import auth from "./routes/auth";

const app = new Hono();

app.use("/*", cors());

app.route("/admin", admin);
app.route("/activate", activate);
app.route("/keys", keys);
app.route("/auth", auth);

export default {
  port: 3000,
  fetch: app.fetch,
};
