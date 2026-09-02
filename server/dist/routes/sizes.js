import { Router } from "express";
import { catalogRouter } from "./catalog.js";
const router = Router();
router.use("/", catalogRouter("sizes", [{ column: "name", label: "Tamanho", type: "string", required: true }], "sort_order ASC", { column: "sort_order", valueSql: "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sizes WHERE company_id = ?)", valueParams: (req) => [req.user.company_id] }, true));
export default router;
