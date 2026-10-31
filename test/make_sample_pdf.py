#!/usr/bin/env python3
"""Generate test/sample.pdf: a tiny ORIGINAL German text (not from any book)
laid out like a natural-method reader: main column, side glosses in the right
margin, chapter headings, a hyphenated line break, an end-of-chapter gap-fill
exercise and one page without a text layer. No dependencies.

    python3 test/make_sample_pdf.py
"""
import os

W, H = 420, 595          # A5-ish, in points
MAIN_X = 40              # left edge of the main column
NOTE_X = 312             # left edge of the margin column (~74% of width)

def esc(s):
    b = s.encode("cp1252")
    out = []
    for ch in b:
        c = chr(ch)
        if c in "()\\":
            out.append("\\" + c)
        elif ch > 126:
            out.append("\\%03o" % ch)
        else:
            out.append(c)
    return "".join(out)

def text(font, size, x, y, s):
    return f"BT /{font} {size} Tf {x} {y} Td ({esc(s)}) Tj ET\n"

# Each page: list of ("main"|"note"|"head"|"title"|"num"|"gap", text, extra)
# Lines are pre-broken; a "gap" entry inserts vertical space (paragraph break).
P = []

P.append([
    ("title", "Lesebuch-Testtext", 0),
    ("sub", "Ein kleiner Originaltext zum Testen", 0),
    ("sub", "(nur für die Entwicklung)", 0),
])

P.append([
    ("head", "Kapitel 1", 0),
    ("head2", "Das Haus am Fluss", 0),
    ("gap", "", 0),
    ("main", "Am Fluss steht ein kleines Haus. Das Haus", "das Haus, die Häuser"),
    ("main", "ist alt, aber es ist schön. Vor dem Haus", ""),
    ("main", "steht ein Baum. Der Baum ist groß und grün.", "der Baum, die Bäume"),
    ("main", "Im Haus wohnt eine Frau. Die Frau heißt", ""),
    ("main", "Anna. Anna ist Lehrerin, sie arbeitet in der", "arbeiten – spielen"),
    ("main", "Schule im Dorf.", ""),
    ("gap", "", 0),
    ("main", "   Anna hat einen Hund. Der Hund heißt Max.", "der Hund"),
    ("main", "Max liegt gern auf der Fenster-", ""),
    ("main", "bank und schaut auf den Fluss. Ist der", "die Fensterbank"),
    ("main", "Fluss breit? Ja, der Fluss ist breit, aber", "breit – schmal"),
    ("main", "er ist nicht tief.", ""),
    ("gap", "", 0),
    ("main", "   Am Morgen trinkt Anna Kaffee. Sie sitzt", "trinken: ich trinke,"),
    ("main", "am Tisch und liest die Zeitung. Dann geht", "sie trinkt"),
    ("main", "sie mit Max zur Schule.", ""),
    ("num", "1", 0),
])

P.append([
    ("main", "   Die Kinder in der Schule sind froh, wenn", "froh = glücklich"),
    ("main", "Max kommt. Max ist ein freundlicher Hund.", ""),
    ("gap", "", 0),
    ("head2", "Übung 1", 0),
    ("gap", "", 0),
    ("main", "1. D… Haus steht am Fluss.", ""),
    ("main", "2. Anna wohnt in d.. Dorf.", ""),
    ("main", "3. Der Hund ___ auf der Fensterbank.", ""),
    ("main", "4. Der Fluss ist breit, aber nicht ... .", ""),
    ("main", "5. Am Morgen trink… Anna Kaffee.", ""),
    ("num", "2", 0),
])

P.append([
    ("head", "Kapitel 2", 0),
    ("head2", "Der Markt", 0),
    ("gap", "", 0),
    ("main", "Heute ist Samstag. Anna geht auf den Markt.", "der Markt, die Märkte"),
    ("main", "Auf dem Markt gibt es Obst und Gemüse. Die", "das Obst"),
    ("main", "Äpfel sind rot, die Birnen sind gelb. Anna", "der Apfel, die Äpfel"),
    ("main", "kauft drei Äpfel und eine Gurke.", ""),
    ("gap", "", 0),
    ("main", "   „Was kostet die Gurke?“, fragt Anna. Die", "fragen – antworten"),
    ("main", "Verkäuferin antwortet: „Die Gurke kostet", ""),
    ("main", "einen Euro.“ Anna bezahlt und sagt: „Danke", ""),
    ("main", "schön, auf Wiedersehen!“", ""),
    ("num", "3", 0),
])

P.append([])  # no text layer: tests the OCR offer

def build_page(items):
    ops = []
    y = H - 60
    note_y_by_line = []
    for kind, s, extra in items:
        if kind == "title":
            ops.append(text("F2", 22, MAIN_X, H - 200, s)); continue
        if kind == "sub":
            y2 = H - 230 - 18 * sum(1 for k, *_ in items[: items.index((kind, s, extra))] if k == "sub")
            ops.append(text("F1", 12, MAIN_X, y2, s)); continue
        if kind == "head":
            ops.append(text("F2", 16, MAIN_X, y, s)); y -= 20; continue
        if kind == "head2":
            ops.append(text("F2", 13, MAIN_X, y, s)); y -= 18; continue
        if kind == "gap":
            y -= 8; continue
        if kind == "num":
            ops.append(text("F1", 9, W / 2 - 3, 30, s)); continue
        # main line (+ optional margin gloss on the same baseline)
        ops.append(text("F1", 11, MAIN_X, y, s))
        if extra:
            ops.append(text("F3", 8, NOTE_X, y + 1, extra))
        y -= 15
    if not items:
        # a "scanned" page: just some boxes, no text operators
        ops.append("0.85 g 40 120 340 400 re f 0 g\n")
    return "".join(ops)

objs = []
def add(o):
    objs.append(o); return len(objs)

font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>")
font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>")
font3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>")
pages_id = len(objs) + 1 + 2 * len(P)  # placeholder index, fixed below
kids = []
page_objs = []
for items in P:
    content = build_page(items).encode("latin-1")
    cid = add(("stream", content))
    pid = add(None)
    page_objs.append((pid, cid))
pages_id = add(None)
for pid, cid in page_objs:
    objs[pid - 1] = (f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {W} {H}] "
                     f"/Resources << /Font << /F1 {font1} 0 R /F2 {font2} 0 R /F3 {font3} 0 R >> >> "
                     f"/Contents {cid} 0 R >>")
    kids.append(f"{pid} 0 R")
objs[pages_id - 1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
catalog = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")
info = add("<< /Title (Lesebuch Testtext) /Producer (make_sample_pdf.py) >>")

out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(out))
    if isinstance(o, tuple):
        data = o[1]
        out += f"{i} 0 obj\n<< /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream\nendobj\n"
    else:
        out += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
xref = len(out)
out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample.pdf")
with open(path, "wb") as f:
    f.write(out)
print("wrote", path, len(out), "bytes,", len(P), "pages")
