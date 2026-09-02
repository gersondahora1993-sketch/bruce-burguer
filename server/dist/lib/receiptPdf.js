const PT_PER_MM = 72 / 25.4;
const PAGE_W = Math.round(60 * PT_PER_MM);
const PAD_TOP = 6;
const PAD_BOTTOM = 8;
const MARGIN_X = 3;
const MIN_SIZE = 8;
function escapePdfText(s) {
    let out = "";
    for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 40 || code === 41 || code === 92) {
            out += "\\" + ch;
        }
        else if (code >= 32 && code <= 255) {
            out += ch;
        }
        else {
            out += "?";
        }
    }
    return out;
}
function measuredWidth(text, size) {
    return text.length * size * 0.5;
}
function rowify(text, size, bold, align, gap, maxW) {
    if (measuredWidth(text, size) <= maxW) {
        return [{ text, bold, size, align, gap }];
    }
    const fitSize = Math.floor((maxW * 2) / text.length);
    if (fitSize >= MIN_SIZE) {
        return [{ text, bold, size: fitSize, align, gap }];
    }
    const words = text.split(/\s+/);
    const rows = [];
    let current = "";
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (measuredWidth(candidate, size) <= maxW) {
            current = candidate;
        }
        else {
            if (current)
                rows.push({ text: current, bold, size, align, gap: 0 });
            current = word;
        }
    }
    if (current)
        rows.push({ text: current, bold, size, align, gap: 0 });
    if (!rows.length)
        rows.push({ text, bold, size, align, gap });
    rows[0] = { ...rows[0], gap };
    return rows;
}
export function buildReceiptPdf(lines) {
    const header = "%PDF-1.4\n";
    const objects = [];
    const xrefOffsets = [];
    const maxW = PAGE_W - 2 * MARGIN_X;
    const rows = [];
    for (const line of lines) {
        const size = line.size ?? (line.bold ? 13 : 11);
        const align = line.align ?? "left";
        const text = line.text || "";
        rows.push(...rowify(text, size, !!line.bold, align, line.gap ?? 0, maxW));
    }
    const footerRows = rowify("Documento sem validade fiscal. Gerado pelo sistema Nyellen Fashion.", 9, false, "left", 6, maxW);
    rows.push(...footerRows);
    let totalHeight = PAD_TOP;
    for (const row of rows)
        totalHeight += row.gap + row.size * 1.5;
    totalHeight += PAD_BOTTOM;
    const PAGE_H = Math.ceil(totalHeight);
    const contentParts = [];
    let y = PAGE_H - PAD_TOP;
    for (const row of rows) {
        y -= row.gap;
        const font = row.bold ? "/F2" : "/F1";
        const width = measuredWidth(row.text, row.size);
        const x = row.align === "center" ? (PAGE_W - width) / 2 : MARGIN_X;
        contentParts.push(`BT ${font} ${row.size} Tf ${x} ${y} Td (${escapePdfText(row.text)}) Tj ET`);
        y -= row.size * 1.5;
    }
    const fullStream = contentParts.join("\n") + "\n";
    const addObj = (body) => {
        xrefOffsets.push(Buffer.byteLength(header, "latin1") + objects.reduce((a, o) => a + Buffer.byteLength(o, "latin1"), 0));
        objects.push(`${objects.length + 1} 0 obj\n${body}\nendobj\n`);
    };
    addObj("<</Type /Catalog /Pages 2 0 R>>");
    addObj("<</Type /Pages /Kids [3 0 R] /Count 1>>");
    addObj(`<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources <</Font <</F1 4 0 R /F2 5 0 R>>>> /Contents 6 0 R>>`);
    addObj("<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>");
    addObj("<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding>>");
    addObj(`<</Length ${Buffer.byteLength(fullStream, "latin1")}>>\nstream\n${fullStream}endstream`);
    const xrefStart = Buffer.byteLength(header, "latin1") + objects.reduce((a, o) => a + Buffer.byteLength(o, "latin1"), 0);
    let out = header + objects.join("");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of xrefOffsets) {
        out += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
}
