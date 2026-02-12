import { Hono } from "hono";
import admin from "./admin";
import activate from "./activate";
import keys from "./keys";
import auth from "./auth";

const router = new Hono();

router.route("/admin", admin);
router.route("/activate", activate);
router.route("/keys", keys);
router.route("/auth", auth);

export default router;