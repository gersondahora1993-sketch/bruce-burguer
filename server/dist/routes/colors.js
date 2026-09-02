import { Router } from "express";
import { catalogRouter } from "./catalog.js";
const router = Router();
router.use("/", catalogRouter("colors", [
    { column: "name", label: "Nome", type: "string", required: true },
    { column: "hex", label: "Cor", type: "color", default: "#e5e7eb" },
], "name COLLATE NOCASE ASC", undefined, true));
export default router;
