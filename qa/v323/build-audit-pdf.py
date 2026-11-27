#!/usr/bin/env python3
"""Build the Portuguese audit artifact from repository Markdown, never from secrets.

Usage: python qa/v323/build-audit-pdf.py [--output /workspace/audit.pdf]
ReportLab and PyMuPDF are required. No network, browser or production access.
Rerun after RESULTADOS.md changes; the source hashes are recorded in QA evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import fitz
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, HRFlowable, LongTable, PageBreak, PageTemplate,
    Paragraph, Preformatted, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/v3.2.3"
SOURCES = [
    "AUDITORIA.md", "RESULTADOS.md", "SECURITY-DEFINER.md", "CAS-HTTP.md",
    "HOMOLOGACAO-AUTENTICADA.md", "HOMOLOGACAO.md", "ROLLBACK.md", "GPS-ANDROID.md",
]
ANNEXES = [
    ("Sessão, renovação e logout", "SESSAO.md"),
    ("Gerenciamento dos dados do dispositivo", "DADOS-DISPOSITIVO.md"),
    ("Vínculo, envio e restauração", "VINCULO-BACKUP.md"),
    ("Preservação de jornadas legadas", "LEGADOS.md"),
    ("Orçamento JSONB e proposta incremental", "TAMANHO-BACKUP.md"),
    ("Inventário e justificativa dos arquivos", "ARQUIVOS.md"),
    ("Changelog da candidata", "../../CHANGELOG.md"),
    ("Rollback SQL com guard de contrato", "sql/rollback-cas-http-conflict.sql"),
]
PURPLE = colors.HexColor("#321C54")
MINT = colors.HexColor("#168B87")
INK = colors.HexColor("#202B38")
MUTED = colors.HexColor("#586577")
PALE = colors.HexColor("#F1F5F8")
RULE = colors.HexColor("#D8E0E8")
PAGE_W, PAGE_H = A4
LEFT, RIGHT, TOP, BOTTOM = 43, 43, 51, 42
WIDTH = PAGE_W - LEFT - RIGHT
BRANCH = "codex/desenvolvimento-v3.2.3"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_setup() -> dict:
    base = Path("/usr/share/fonts/truetype/dejavu")
    names = {
        "AuditSans": "DejaVuSans.ttf", "AuditSansBold": "DejaVuSans-Bold.ttf",
        "AuditSansItalic": "DejaVuSans-Oblique.ttf", "AuditMono": "DejaVuSansMono.ttf",
    }
    for name, filename in names.items():
        pdfmetrics.registerFont(TTFont(name, str(base / filename)))
    pdfmetrics.registerFontFamily(
        "AuditSans", normal="AuditSans", bold="AuditSansBold",
        italic="AuditSansItalic", boldItalic="AuditSansBold",
    )
    return {name: str(base / file) for name, file in names.items()}


def styles() -> dict:
    body = ParagraphStyle(
        "Body", fontName="AuditSans", fontSize=9.1, leading=13,
        textColor=INK, spaceAfter=6.5, splitLongWords=True, allowWidows=0,
        allowOrphans=0, alignment=TA_LEFT,
    )
    return {
        "body": body,
        "h1": ParagraphStyle("Heading1", parent=body, fontName="AuditSansBold", fontSize=18.5,
                             leading=23, textColor=PURPLE, spaceAfter=13, keepWithNext=True),
        "h2": ParagraphStyle("Heading2", parent=body, fontName="AuditSansBold", fontSize=12,
                             leading=16, textColor=PURPLE, spaceBefore=12, spaceAfter=7, keepWithNext=True),
        "h3": ParagraphStyle("Heading3", parent=body, fontName="AuditSansBold", fontSize=10.3,
                             leading=14, textColor=MINT, spaceBefore=9, spaceAfter=5, keepWithNext=True),
        "cell": ParagraphStyle("Cell", parent=body, fontSize=8.0, leading=11.1, spaceAfter=0),
        "th": ParagraphStyle("TableHeader", parent=body, fontName="AuditSansBold", fontSize=8.1,
                             leading=11.1, textColor=colors.white, spaceAfter=0),
        "code": ParagraphStyle("Code", parent=body, fontName="AuditMono", fontSize=7.5,
                               leading=10.3, backColor=PALE, borderPadding=7, spaceBefore=4, spaceAfter=9),
        "small": ParagraphStyle("Small", parent=body, fontSize=8.0, leading=11.5, textColor=MUTED),
        "cover": ParagraphStyle("Cover", parent=body, fontName="AuditSansBold", fontSize=29,
                                leading=36, textColor=PURPLE, spaceAfter=15),
    }


def link_url(target: str, source: Path) -> str:
    if re.match(r"https?://", target):
        return target
    name, _, fragment = target.partition("#")
    path = (source.parent / name).resolve()
    try:
        relative = path.relative_to(ROOT).as_posix()
    except ValueError:
        return "https://github.com/LesmoBoy/meu-primeiro-app"
    base = "https://github.com/LesmoBoy/meu-primeiro-app/blob/"
    return base + quote(BRANCH, safe="/") + "/" + quote(relative, safe="/") + ("#" + fragment if fragment else "")


def inline(text: str, source: Path) -> str:
    pattern = r"(`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*)"
    parts = re.split(pattern, text)
    out = []
    for part in parts:
        if not part:
            continue
        if part.startswith("`") and part.endswith("`"):
            out.append('<font name="AuditMono" size="7.6">' + html.escape(part[1:-1]) + "</font>")
        elif part.startswith("**") and part.endswith("**"):
            out.append("<b>" + inline(part[2:-2], source) + "</b>")
        elif part.startswith("[") and (match := re.fullmatch(r"\[([^\]]+)\]\(([^\s)]+)\)", part)):
            target = html.escape(link_url(match.group(2), source), quote=True)
            out.append('<link href="' + target + '" color="#168B87">' + inline(match.group(1), source) + "</link>")
        else:
            out.append(html.escape(part))
    return "".join(out)


def columns(cells: list[str]) -> list[float]:
    count = len(cells)
    if count == 4:
        weights = [0.19, 0.27, 0.29, 0.25] if cells[0].strip() == "Função" else [0.19, 0.31, 0.24, 0.26]
    elif count == 3:
        weights = [0.28, 0.34, 0.38]
    elif count == 2:
        weights = [0.33, 0.67]
    else:
        weights = [1 / count] * count
    return [WIDTH * weight for weight in weights]


def markdown_flowables(text: str, source: Path, sheet: dict) -> list:
    lines = text.splitlines()
    flow = []
    index = 0
    heading_count = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith("```"):
            index += 1
            code = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                raw = lines[index].expandtabs(2)
                while len(raw) > 100:
                    code.append(raw[:100] + " ↪")
                    raw = "  " + raw[100:]
                code.append(raw)
                index += 1
            flow.append(Preformatted("\n".join(code), sheet["code"]))
            index += 1
            continue
        if line.startswith("|"):
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                current = lines[index].strip().strip("|")
                row = [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", current)]
                if not all(re.fullmatch(r":?-{2,}:?", cell.replace(" ", "")) for cell in row):
                    rows.append(row)
                index += 1
            if not rows:
                continue
            count = len(rows[0])
            if any(len(row) != count for row in rows):
                raise ValueError("Malformed Markdown table in " + source.name)
            parsed = []
            for row_index, row in enumerate(rows):
                rendered = []
                for column_index, cell in enumerate(row):
                    cell_text = inline(cell, source)
                    # Give long SQL signatures intentional break points instead
                    # of cutting a function name in the middle of a syllable.
                    if row_index and column_index == 0 and rows[0][0] == "Função":
                        signature = re.fullmatch(r"`(business_)([a-z_]+)(\(.*\))`", cell)
                        if signature:
                            cell_text = '<font name="AuditMono" size="7.6">' + "<br/>".join(
                                html.escape(part) for part in signature.groups()) + "</font>"
                    rendered.append(Paragraph(cell_text, sheet["th"] if row_index == 0 else sheet["cell"]))
                parsed.append(rendered)
            table = LongTable(parsed, colWidths=columns(rows[0]), repeatRows=1,
                              hAlign="LEFT", splitByRow=1, splitInRow=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), PURPLE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, PURPLE),
                ("LINEBELOW", (0, 1), (-1, -1), 0.35, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            flow.extend([table, Spacer(1, 9)])
            continue
        if match := re.match(r"^(#{1,6})\s+(.+)$", line):
            level = min(len(match.group(1)), 3)
            paragraph = Paragraph(inline(match.group(2), source), sheet["h" + str(level)])
            heading_count += 1
            paragraph._audit_bookmark = (source.stem + "-" + str(heading_count), level - 1, match.group(2))
            flow.append(paragraph)
            index += 1
            continue
        if match := re.match(r"^[-*]\s+\[([ xX])\]\s+(.+)$", line):
            prefix = "CONCLUÍDO" if match.group(1).lower() == "x" else "PENDENTE"
            flow.append(Paragraph("<b>" + prefix + ":</b> " + inline(match.group(2), source), sheet["body"]))
            index += 1
            continue
        if re.match(r"^(?:[-*]|\d+\.)\s+", line):
            flow.append(Paragraph(inline(line, source), sheet["body"]))
            index += 1
            continue
        paragraph = [line]
        index += 1
        while index < len(lines):
            nxt = lines[index].strip()
            if not nxt or re.match(r"^(?:#|\||```|[-*]\s|\d+\.\s)", nxt):
                break
            paragraph.append(nxt)
            index += 1
        flow.append(Paragraph(inline(" ".join(paragraph), source), sheet["body"]))
    return flow


class AuditDocument(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if value := getattr(flowable, "_audit_bookmark", None):
            # NumberedCanvas writes its physical pages in a second pass; creating
            # destinations in the first pass would make every bookmark point at 1.
            self.canv._audit_bookmarks.append(value)


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._page_states = []
        self._audit_bookmarks = []

    def showPage(self):
        self._page_states.append(dict(self.__dict__))
        self._startPage()
        self._audit_bookmarks = []

    def save(self):
        total = len(self._page_states)
        for state in self._page_states:
            self.__dict__.update(state)
            self.setStrokeColor(RULE)
            self.line(LEFT, 31, PAGE_W - RIGHT, 31)
            self.setFont("AuditSans", 7)
            self.setFillColor(MUTED)
            self.drawString(LEFT, 20, "Minha Rodagem 3.2.3 · Auditoria técnica · Candidata de homologação")
            self.drawRightString(PAGE_W - RIGHT, 20, f"{self._pageNumber} / {total}")
            for key, level, title in self._audit_bookmarks:
                self.bookmarkPage(key)
                self.addOutlineEntry(title, key, level=min(level, 2), closed=level > 0)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)


def header(canv, document):
    if document.page == 1:
        return
    canv.saveState()
    canv.setFillColor(MINT)
    canv.rect(LEFT, PAGE_H - 27, 22, 3, fill=1, stroke=0)
    canv.setFillColor(MUTED)
    canv.setFont("AuditSans", 7.2)
    canv.drawString(LEFT + 29, PAGE_H - 27, "ESTABILIDADE · SEGURANÇA · INTEGRIDADE DOS DADOS")
    canv.restoreState()


def check_sources(contents: dict[str, str]):
    text = "\n".join(contents.values())
    if re.search(r"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}", text):
        raise ValueError("Raw JWT-like material found; review inputs without exposing it.")
    if re.search(r"\b(?:sb_secret_|sk_live_)[A-Za-z0-9_-]{12,}", text):
        raise ValueError("Secret-like material found; review inputs without exposing it.")
    for address in re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text):
        if not address.endswith(".test") and address != "rodadiaempresas@gmail.com":
            raise ValueError("Nonpublic email address found in source; review before exporting.")


def validate_pdf(output: Path, source_hashes: dict, fonts: dict) -> dict:
    document = fitz.open(output)
    full = "\n".join(page.get_text() for page in document)
    normalized = re.sub(r"\s+", " ", full).casefold()
    joined = re.sub(r"\s+", "", full)
    required = {
        "physicalTestsExplicitlyNotExecuted": "testes físicos android/gps/bateria: não executados" in normalized,
        "googleOidcExplicitlyNotExecuted": "google oidc externo da v3.2.3: não executado" in normalized,
        "productionNotAuthorized": "publicação/migração em produção: não autorizada nem executada" in normalized,
        "noCommercialCertification": "não certifica ausência de vulnerabilidades" in normalized,
        "securityDefinerMatrixPresent": "business_membership_role" in joined and "business_save_member" in joined,
        "rollbackPresent": "rollback e autorização" in normalized,
        "outlineTargetsValid": bool(document.get_toc()) and all(1 < item[2] <= len(document) for item in document.get_toc()),
    }
    if not all(required.values()):
        raise ValueError("Required audit limitation/section missing: " + json.dumps(required))
    outside = []
    for number, page in enumerate(document, 1):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    if x0 < 15 or y0 < 8 or x1 > PAGE_W - 15 or y1 > PAGE_H - 8:
                        outside.append({"page": number, "bbox": list(span["bbox"])})
    if outside:
        raise ValueError("Text exceeds safe page bounds: " + json.dumps(outside[:5]))
    preview = Path("/workspace/minha-rodagem-v323-pdf-preview")
    preview.mkdir(parents=True, exist_ok=True)
    # Cover, dense technical pages and final checklist/GPS pages, rendered without a browser.
    sample = sorted({0, min(2, len(document)-1), len(document)//2, max(0, len(document)-3), len(document)-1})
    previews = []
    for number in sample:
        path = preview / f"pagina-{number+1:02d}.png"
        document[number].get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False).save(path)
        previews.append(str(path))
    report = {
        "classification": "standalone-audit-document-build-and-pdf-layout-check",
        "generatedAt": datetime.now(timezone.utc).isoformat(), "pdf": str(output),
        "pdfSha256": digest(output), "pages": len(document), "sourceSha256": source_hashes,
        "unicodeFonts": fonts, "checks": required, "outOfPageTextSpans": outside,
        "previewPngs": previews, "productionMutation": False,
        "physicalDeviceTests": False, "externalGoogleOidcTests": False,
        "note": "PDF verification proves artifact content/layout, not application correctness. CI status is copied from the current Markdown sources.",
    }
    document.close()
    (ROOT / "qa/v323/audit-pdf-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/workspace/Auditoria-Tecnica-Minha-Rodagem-v3.2.3.pdf"))
    args = parser.parse_args()
    contents = {name: (DOCS / name).read_text() for name in SOURCES}
    check_sources(contents)
    fonts = font_setup()
    sheet = styles()
    story = [Spacer(1, 45), Paragraph("MINHA RODAGEM<br/>v3.2.3", sheet["cover"]),
             Paragraph("Auditoria técnica completa e candidata de homologação", sheet["h2"]),
             HRFlowable(width="100%", thickness=2, color=MINT), Spacer(1, 17),
             Paragraph("Estabilidade, segurança e integridade dos dados", sheet["body"]),
             Paragraph("Referência auditada: v3.2.2, 26/11/2026.<br/>Commit: <font name=\"AuditMono\" size=\"8\">8f4cae36367f667ca871bd2539891ad6d1a74599</font><br/>Branch dedicada: " + BRANCH, sheet["small"]),
             Spacer(1, 16),
             Paragraph("<b>Testes físicos Android/GPS/bateria: NÃO EXECUTADOS.</b><br/>"
                       "Google OIDC externo da v3.2.3: NÃO EXECUTADO.<br/>"
                       "Publicação/migração em produção: NÃO AUTORIZADA NEM EXECUTADA.", sheet["body"]),
             Paragraph("Esta auditoria separa correções implementadas, resultados executados e cenários pendentes. "
                       "Não certifica ausência de vulnerabilidades nem libera comercialização.", sheet["body"]),
             Spacer(1, 13),
             Paragraph("Conteúdo", sheet["h3"]),
             Paragraph("Auditoria e comparação entre versões · Evidências por categoria · Matriz das 11 funções "
                       "SECURITY DEFINER · Conflitos CAS/HTTP · Homologação autenticada local · Checklist de aceite "
                       "· Rollback · Roteiro físico Android", sheet["body"]),
             Paragraph("Os resultados refletem os documentos do repositório no momento desta geração. "
                       "O relatório de construção registra os hashes das fontes e do PDF.", sheet["small"])]
    for name in SOURCES:
        story.append(PageBreak())
        story.extend(markdown_flowables(contents[name], DOCS / name, sheet))
    story.extend([PageBreak(), Paragraph("Anexos e reprodução", sheet["h1"]),
                  Paragraph("Os documentos completos e testes reproduzíveis integram a branch da candidata. "
                            "Os links abaixo abrem o código-fonte; não autorizam execução em produção.", sheet["body"])])
    for label, name in ANNEXES:
        story.append(Paragraph(inline(f"[{label}]({name})", DOCS / "AUDITORIA.md"), sheet["body"]))
    story.append(Spacer(1, 10))
    story.append(Preformatted("python qa/v323/build-audit-pdf.py\n# Reexecutar depois de atualizar RESULTADOS.md", sheet["code"]))
    source_hashes = {f"docs/v3.2.3/{name}": digest(DOCS / name) for name in SOURCES}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    document = AuditDocument(str(args.output), pagesize=A4, leftMargin=LEFT, rightMargin=RIGHT,
                             topMargin=TOP, bottomMargin=BOTTOM, title="Minha Rodagem v3.2.3 — Auditoria técnica",
                             author="Minha Rodagem", subject="Candidata de homologação; limitações explícitas; sem publicação em produção")
    frame = Frame(LEFT, BOTTOM, WIDTH, PAGE_H-TOP-BOTTOM, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    document.addPageTemplates(PageTemplate(id="audit", frames=[frame], onPage=header))
    document.build(story, canvasmaker=NumberedCanvas)
    report = validate_pdf(args.output, source_hashes, fonts)
    if report["pages"] > 35:
        raise ValueError("PDF exceeds 35 pages; condense source selection before delivery.")
    print(json.dumps({"pdf": str(args.output), "pages": report["pages"], "sha256": report["pdfSha256"],
                      "layoutChecksPassed": True, "previews": report["previewPngs"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
