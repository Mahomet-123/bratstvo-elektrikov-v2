#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================================
Разбор прайс-листа «Братство Электриков ЧР» из PDF в данные для таблицы.

Запуск:  python scripts/parse-price-pdf.py [путь_к_pdf] [путь_к_json]

Особенности исходного PDF (проверено на Прайс_Лист_..._Погонаж.pdf):
  * Разделы помечены кружками ①…⑧. Кружок ⑥ в файле повреждён — вместо него
    в текст попадает «184», поэтому раздел «Умный дом и IoT» распознаётся
    по названию, а не по символу.
  * Позиция 184 в прайсе отсутствует — это и есть заголовок раздела ⑥.
  * Единица «раз» идёт слитно с числом: «1раз 1100».
  * Коэффициенты записаны с десятичной запятой: «коэф. 1,5».
  * Позиции 205 и 206 — примечания, без единицы и цены.
============================================================================
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

# --- Пути по умолчанию ------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PDF = Path.home() / "Downloads" / "Telegram Desktop" / "Прайс_Лист_Братство_Электриков_ЧР_Погонаж.pdf"
DEFAULT_JSON = ROOT / "backend" / "seed" / "price.json"

# --- Справочники ------------------------------------------------------------

# Кружок → название раздела. Всего 8 разделов, как в исходном прайсе.
SECTIONS = {
    "①": "Монтажные работы",
    "②": "Черновые работы",
    "③": "Установка щитов",
    "④": "Чистовая установка",
    "⑤": "Дополнительные работы",
    "⑥": "Умный дом и IoT",
    "⑦": "Коэффициенты и особые условия",
    "⑧": "Примечания",
}

# Единицы измерения. «раз» стоит последней, потому что может идти слитно с числом.
UNIT_RE = re.compile(r"(шт\.|м/п|см\.|кв\.м\.?|кВА|%|коэф\.|раз)\s*$", re.IGNORECASE)

# Заголовок раздела ⑥, у которого в PDF потерян кружок.
BROKEN_SECTION_RE = re.compile(r"^\s*\d{1,3}\s+(Умный дом и IoT.*)$", re.IGNORECASE)

# Строка-позиция: номер + текст.
ITEM_RE = re.compile(r"^\s*(\d{1,3})\s+(\S.*)$")

# Число в конце строки — цена. Допускаем десятичную запятую и пробелы-разделители.
PRICE_RE = re.compile(r"(\d[\d\s]*(?:[.,]\d+)?)\s*$")

# Строки, которые нужно пропускать: колонтитулы и шапка таблицы.
SKIP_RE = re.compile(
    r"^(Братство Электриков ЧР|Ед\.\s*Изм|стр\.|Прайс-лист)",
    re.IGNORECASE,
)


def read_pdf_text(pdf_path: Path) -> str:
    """Склеивает текст всех страниц PDF."""
    reader = PdfReader(str(pdf_path))
    parts = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def clean_line(line: str) -> str:
    """Убирает неразрывные пробелы и лишние пробелы по краям."""
    return line.replace("\u00a0", " ").replace("\u202f", " ").strip()


def classify_unit(unit: str) -> str:
    """Тип позиции по единице измерения."""
    u = (unit or "").strip().lower()
    if u.startswith("коэф"):
        return "coeff"
    if u == "%":
        return "percent"
    if not u:
        return "note"
    return "work"


def parse_item(tail: str):
    """
    Разбирает хвост строки позиции: «название … единица [от] цена».
    Возвращает (name, unit, price, is_from) либо None, если цены нет.
    """
    text = tail.strip()

    price_match = PRICE_RE.search(text)
    if not price_match:
        return None

    price_raw = price_match.group(1).replace(" ", "").replace(",", ".")
    try:
        price = float(price_raw)
    except ValueError:
        return None

    before = text[: price_match.start()].strip()

    unit = ""
    unit_match = UNIT_RE.search(before)
    if unit_match:
        unit = unit_match.group(1).strip()
        # Приводим единицы к единому виду.
        unit = {
            "кв.м.": "кв.м",
            "КВ.М": "кв.м",
            "раз": "раз",
        }.get(unit, unit)
        before = before[: unit_match.start()].strip()

    # У «раз» перед единицей стоит количество — «1раз».
    before = re.sub(r"\s*\d+\s*$", "", before).strip() if unit == "раз" else before

    is_from = False
    if re.search(r"\bот\s*$", before, re.IGNORECASE):
        is_from = True
        before = re.sub(r"\bот\s*$", "", before, flags=re.IGNORECASE).strip()

    name = re.sub(r"\s{2,}", " ", before).strip(" .") or tail.strip()
    return name, unit, price, is_from


def parse_price(text: str):
    """Основной разбор: возвращает список позиций и список замечаний."""
    items = []
    warnings = []
    current_section = SECTIONS["①"]
    seen_sections = []

    for raw in text.split("\n"):
        line = clean_line(raw)
        if not line:
            continue
        if SKIP_RE.match(line):
            continue

        # 1. Заголовок раздела, помеченный кружком.
        if line[0] in SECTIONS:
            current_section = SECTIONS[line[0]]
            if current_section not in seen_sections:
                seen_sections.append(current_section)
            continue

        # 2. Заголовок раздела ⑥ с потерянным кружком.
        broken = BROKEN_SECTION_RE.match(line)
        if broken:
            current_section = SECTIONS["⑥"]
            if current_section not in seen_sections:
                seen_sections.append(current_section)
            continue

        # 3. Строка позиции.
        item_match = ITEM_RE.match(line)
        if not item_match:
            warnings.append("строка без номера: " + line)
            continue

        number = int(item_match.group(1))
        tail = item_match.group(2).strip()

        parsed = parse_item(tail)
        if parsed is None:
            # Позиция без цены — примечание или поясняющая строка.
            items.append(
                {
                    "n": number,
                    "section": "Примечания" if current_section == "Примечания" else current_section,
                    "name": tail,
                    "unit": "",
                    "price": 0,
                    "from": False,
                    "kind": "note",
                }
            )
            continue

        name, unit, price, is_from = parsed
        kind = classify_unit(unit)
        items.append(
            {
                "n": number,
                "section": current_section,
                "name": name,
                "unit": unit,
                "price": round(price, 2),
                "from": is_from,
                "kind": kind,
            }
        )

    return items, warnings, seen_sections


def main():
    pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_JSON

    if not pdf_path.exists():
        print("Файл прайса не найден: " + str(pdf_path))
        sys.exit(1)

    text = read_pdf_text(pdf_path)
    items, warnings, seen_sections = parse_price(text)

    # Позиция 1 — не работа, а шапка прайса («без учёта опусков»).
    # Выносим её в преамбулу, чтобы в списке остались только реальные позиции.
    preamble = ""
    for item in list(items):
        if item["n"] == 1:
            preamble = item["name"]
            items.remove(item)

    items.sort(key=lambda x: x["n"])

    by_section = {}
    for item in items:
        by_section.setdefault(item["section"], []).append(item)

    works = [i for i in items if i["kind"] == "work"]
    coeffs = [i for i in items if i["kind"] == "coeff"]
    percents = [i for i in items if i["kind"] == "percent"]
    notes = [i for i in items if i["kind"] == "note"]

    payload = {
        "meta": {
            "source": pdf_path.name,
            "parsedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sections": [SECTIONS[k] for k in sorted(SECTIONS)],
            "total": len(items),
            "works": len(works),
            "coefficients": len(coeffs),
            "percents": len(percents),
            "notes": len(notes),
        },
        "items": items,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("Источник: " + str(pdf_path))
    print("Сохранено: " + str(out_path))
    print("Позиций всего: %d (работы %d, коэффициенты %d, проценты %d, примечания %d)"
          % (len(items), len(works), len(coeffs), len(percents), len(notes)))
    print("\nРазделы:")
    for name in SECTIONS.values():
        group = by_section.get(name, [])
        works_in = len([i for i in group if i["kind"] == "work"])
        print("  %-34s всего %3d, работ %3d" % (name, len(group), works_in))

    missing = [name for name in SECTIONS.values() if name not in by_section]
    if missing:
        print("\nВНИМАНИЕ, пустые разделы: " + ", ".join(missing))

    if warnings:
        print("\nЗамечания (%d):" % len(warnings))
        for w in warnings[:20]:
            print("  " + w)

    numbers = [i["n"] for i in items]
    gaps = [n for n in range(min(numbers), max(numbers) + 1) if n not in numbers]
    print("\nОтсутствующие номера: " + (", ".join(map(str, gaps)) if gaps else "нет"))


if __name__ == "__main__":
    main()
