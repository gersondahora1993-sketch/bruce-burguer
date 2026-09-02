import assert from "node:assert/strict";

import { code128Svg } from "../../web/src/lib/barcode128.js";
import {
  BARCODE_HEIGHT_PX,
  BARCODE_MODULE_WIDTH,
  BARCODE_QUIET_MODULES,
  BARCODE_WIDTH_MM,
  GOOD_BARCODE_MODULE_MM,
  LABEL_CONTENT_HEIGHT_MM,
  LABEL_CONTENT_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_PADDING_MM,
  LABEL_WIDTH_MM,
  MAX_QUANTITY,
  MIN_BARCODE_MODULE_MM,
  barcodeLabelMetrics,
  countLabelCopies,
  labelFits40,
  parseLabelItems,
} from "../../web/src/lib/labels.js";

let checks = 0;
function pass(condition: boolean, label: string): void {
  assert.equal(condition, true, label);
  checks += 1;
}

const metrics: Record<string, ReturnType<typeof barcodeLabelMetrics>> = {};
const fits: Record<string, boolean> = {};

try {
  // ---- 1. Configuração física 40×40 mm ----
  pass(LABEL_WIDTH_MM === 40, `etiqueta deve ter 40 mm de largura (atual: ${LABEL_WIDTH_MM})`);
  pass(LABEL_HEIGHT_MM === 40, `etiqueta deve ter 40 mm de altura (atual: ${LABEL_HEIGHT_MM})`);
  pass(LABEL_PADDING_MM > 0, `padding da etiqueta deve ser positivo (atual: ${LABEL_PADDING_MM})`);
  pass(LABEL_CONTENT_WIDTH_MM > 0 && LABEL_CONTENT_WIDTH_MM < LABEL_WIDTH_MM, "largura útil dentro dos 40 mm");
  pass(LABEL_CONTENT_HEIGHT_MM > 0 && LABEL_CONTENT_HEIGHT_MM < LABEL_HEIGHT_MM, "altura útil dentro dos 40 mm");
  pass(BARCODE_WIDTH_MM > 0 && BARCODE_WIDTH_MM <= LABEL_CONTENT_WIDTH_MM, "barcode cabe na largura útil da etiqueta");
  pass(BARCODE_QUIET_MODULES >= 10, `zona de silêncio >= 10 módulos (atual: ${BARCODE_QUIET_MODULES})`);
  pass(MAX_QUANTITY === 99, "quantidade máxima por variação é 99");

  // ---- 2. parseLabelItems ----
  pass(parseLabelItems(null).length === 0, "null => nenhuma etiqueta");
  pass(parseLabelItems("").length === 0, "string vazia => nenhuma etiqueta");
  assert.deepEqual(parseLabelItems("7:3,8:2"), [
    { variationId: 7, quantity: 3 },
    { variationId: 8, quantity: 2 },
  ]);
  pass(true, "parse '7:3,8:2' => [{7,3},{8,2}]");
  assert.deepEqual(parseLabelItems("7:0"), [{ variationId: 7, quantity: 1 }]);
  pass(true, "quantidade 0 é normalizada para 1");
  assert.deepEqual(parseLabelItems("7:150"), [{ variationId: 7, quantity: MAX_QUANTITY }]);
  pass(true, `quantidade > ${MAX_QUANTITY} é limitada para ${MAX_QUANTITY}`);
  assert.deepEqual(parseLabelItems("7:abc"), [{ variationId: 7, quantity: 1 }]);
  pass(true, "quantidade inválida cai para 1");
  assert.deepEqual(parseLabelItems("x:1, 9:2"), [{ variationId: 9, quantity: 2 }]);
  pass(true, "variação inválida é ignorada");
  assert.deepEqual(parseLabelItems("5:1,,6:2,"), [
    { variationId: 5, quantity: 1 },
    { variationId: 6, quantity: 2 },
  ]);
  pass(true, "partes vazias (separadores) são ignoradas");

  // ---- 3. Uma etiqueta por variação × quantidade (impressão em lote) ----
  const entries = parseLabelItems("7:3,8:2");
  pass(countLabelCopies(entries) === 5, `lote '7:3,8:2' => 5 etiquetas (${countLabelCopies(entries)})`);
  pass(countLabelCopies([]) === 0, "lote vazio => 0 etiquetas");
  pass(
    countLabelCopies(parseLabelItems("1:1,2:1,3:1")) === 3,
    "lote individual (1 por variação) => uma etiqueta por variação"
  );

  // ---- 4. Métricas do barcode (esforço de leitura) ----
  const codes = ["790255", "850001", "12345678", "123456789012", "12345678901234", "NY-00010001"];
  for (const code of codes) {
    const m = barcodeLabelMetrics(code);
    metrics[code] = m;
    fits[code] = labelFits40(code);
    pass(m.widthMm > 0 && m.widthMm <= LABEL_CONTENT_WIDTH_MM, `largura do barcode de ${code} cabe nos 40 mm`);
    pass(m.activeWidthMm > 0 && m.activeWidthMm < m.widthMm, `zonas de silêncio presentes em ${code}`);
    pass(m.quietMm >= 2, `zona de silêncio >= 2 mm em ${code} (atual: ${m.quietMm.toFixed(2)})`);
    pass(
      m.heightMm >= 10 && m.heightMm <= LABEL_CONTENT_HEIGHT_MM,
      `altura do barcode de ${code} entre 10 e ${LABEL_CONTENT_HEIGHT_MM} mm (atual: ${m.heightMm.toFixed(2)})`
    );
    const svg = code128Svg(code, { moduleWidth: BARCODE_MODULE_WIDTH, height: BARCODE_HEIGHT_PX });
    pass(svg.startsWith("<svg"), `SVG renderizado para ${code}`);
    pass(svg.includes(code), `SVG inclui o número legível para ${code}`);
  }

  // ------------------ casos numéricos típicos da loja ------------------
  pass(
    metrics["790255"].moduleWidthMm >= GOOD_BARCODE_MODULE_MM,
    `6 dígitos ("790255") => módulo ${metrics["790255"].moduleWidthMm.toFixed(3)} mm >= ${GOOD_BARCODE_MODULE_MM} mm (3 dots @203dpi)`
  );
  pass(
    metrics["850001"].moduleWidthMm >= GOOD_BARCODE_MODULE_MM,
    `6 dígitos ("850001") => módulo ${metrics["850001"].moduleWidthMm.toFixed(3)} mm >= ${GOOD_BARCODE_MODULE_MM} mm`
  );
  pass(
    metrics["12345678"].moduleWidthMm >= MIN_BARCODE_MODULE_MM,
    `8 dígitos => módulo ${metrics["12345678"].moduleWidthMm.toFixed(3)} mm >= mínimo ${MIN_BARCODE_MODULE_MM} mm`
  );
  pass(
    metrics["123456789012"].moduleWidthMm >= MIN_BARCODE_MODULE_MM,
    `12 dígitos => módulo ${metrics["123456789012"].moduleWidthMm.toFixed(3)} mm >= mínimo ${MIN_BARCODE_MODULE_MM} mm`
  );
  pass(fits["790255"], "código numérico típico cabe e é legível (labelFits40)");
  pass(fits["850001"], "código numérico típico cabe e é legível (labelFits40)");
  pass(fits["12345678"], "8 dígitos cabe e é legível (labelFits40)");

  // ------------------ casos limites documentados ------------------
  // 14+ dígitos ou códigos com letras têm módulo fino demais para leitura garantida
  // em 40 mm — a largura cabe, mas a legibilidade não é garantida (limitacão física).
  pass(
    metrics["12345678901234"].moduleWidthMm < MIN_BARCODE_MODULE_MM &&
      !fits["12345678901234"],
    "14 dígitos é marcado como não-garantido em 40 mm (módulo fino) — limitação documentada"
  );
  pass(
    metrics["NY-00010001"].moduleWidthMm < MIN_BARCODE_MODULE_MM,
    "código com letras é marcado como não-garantido em 40 mm (módulo fino) — limitação documentada"
  );

  console.log(
    JSON.stringify({
      status: "PASS",
      checks,
      label_width_mm: LABEL_WIDTH_MM,
      label_height_mm: LABEL_HEIGHT_MM,
      content_mm: LABEL_CONTENT_WIDTH_MM,
      barcode_width_mm: BARCODE_WIDTH_MM,
      fits,
      metrics: Object.fromEntries(Object.entries(metrics).map(([k, m]) => [k, { ...m, moduleWidthMm: Number(m.moduleWidthMm.toFixed(3)), heightMm: Number(m.heightMm.toFixed(2)) }])),
    })
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}