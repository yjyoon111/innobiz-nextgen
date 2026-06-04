#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT_DIR / "web-dashboard"
DATA_DIR = WEB_DIR / "data"
OUTPUT_JSON = DATA_DIR / "dashboard.json"
OUTPUT_JS = DATA_DIR / "dashboard.js"


K_NO = "\ubc88\ud638"
K_AMOUNT = "\uae08\uc561"
K_WEEK = "\ucc28\uc218"
K_DETAIL = "\ub0b4\uc5ed"
K_CATEGORY = "\ub300\ubd84\ub958"
K_VENDOR = "\uac70\ub798\ucc98"
K_DATE = "\uc77c\uc790"

K_WEEK_SUFFIX = "\uc8fc"
K_WEEK_LABEL = "\uc8fc\ucc28"

K_EDU_BEFORE = "\uad50\uc721\uc804"
K_TOTAL = "\uc804\uccb4"
K_UNCLASSIFIED = "\ubbf8\ubd84\ub958"

K_BUDGET_SECTION = "\uad6c\ubd84"
K_BUDGET_DETAIL = "\uc138\ubd80\ub0b4\uc5ed"
K_SUM = "\ud569\uacc4"


SOURCE_CANDIDATES: Dict[str, List[str]] = {
    "settlement_3rd": ["\ucc28\uacbd 3\uae30 \uc815\uc0b0\uc11c.xlsx", "settlement_3rd.xlsx"],
    "settlement_4th": ["\ucc28\uacbd 4\uae30 \uc815\uc0b0\uc11c.xlsx", "settlement_4th.xlsx"],
    "budget_4th": ["\uc608\uc0b0\uacc4\ud68d 4.xlsx", "budget_4th.xlsx"],
}

ATTENDANCE_CANDIDATES: List[Path] = [
    ROOT_DIR / "출석정리" / "차세대경영자아카데미_출석정리_28명_1~3주차.xlsx",
    ROOT_DIR / "출석정리" / "차세대경영자아카데미_출석정리_1~3주차.xlsx",
    ROOT_DIR / "attendance_28.xlsx",
    ROOT_DIR / "attendance_1.xlsx",
]


CATEGORY_RULES = [
    (
        "food",
        "\uc2dd\uc74c\ub8cc",
        [
            "\ub2e4\uacfc",
            "\uc2dd\ube44",
            "\ubb34\ub8cc\uc138\ubbf8\ub098",
        ],
    ),
    (
        "lecture",
        "\uac15\uc758/\uc9c4\ud589/\uc778\ub825",
        [
            "\uac15\uc0ac",
            "\uac15\uc758",
            "\uc561\uc158\ub7ec\ub2dd",
            "\uc9c4\ud589\ube44",
            "\ud2b9\uac15",
            "\uc778\uac74\ube44",
        ],
    ),
    (
        "prep",
        "\uc900\ube44/\uc778\uc1c4/\ubb3c\ud488",
        [
            "\uc900\ube44",
            "\uc778\uc1c4",
            "\uad50\uc7ac",
            "\uc0ac\ubb34\uc6a9\ud488",
            "\ud604\uc218\ub9c9",
            "\uae30\ub150\ud488",
            "\uc601\uc0c1",
            "\ud589\uc0ac\uc6a9\ud488",
        ],
    ),
    (
        "ops",
        "\uc7a5\uc18c/\uc6b4\uc601",
        [
            "\ub300\uad00",
            "\uc784\ub300",
            "\uc8fc\ucc28",
            "\uc784\ucc28",
            "\uc219\ubc15",
            "\uc785\uc7a5\ub8cc",
            "\ud638\uc2a4\ud305",
        ],
    ),
    (
        "expo",
        "\ud574\uc678\uc804\uc2dc",
        [
            "\ud574\uc678",
            "\uc804\uc2dc",
            "\ud56d\uacf5",
            "\ud638\ud154",
            "\uac00\uc774\ub4dc",
            "\ucc28\ub7c9",
            "\ud1b5\uc5ed",
            "\uc5ec\ud589\uc790\ubcf4\ud5d8",
            "\ud578\ub4e4\ub9c1",
        ],
    ),
    (
        "event",
        "\ud589\uc0ac",
        [
            "\uc878\uc5c5\uc2dd",
            "\uc878\uc5c5\uc5ec\ud589",
        ],
    ),
]


@dataclass
class Sources:
    settlement_3rd: Path
    settlement_4th: Path
    budget_4th: Path


def resolve_sources() -> Sources:
    resolved: Dict[str, Path] = {}
    for key, candidates in SOURCE_CANDIDATES.items():
        found = None
        for name in candidates:
            p = ROOT_DIR / name
            if p.exists():
                found = p
                break
        if found is None:
            raise FileNotFoundError(
                f"source file not found: {key}. candidates={candidates}, root={ROOT_DIR}"
            )
        resolved[key] = found
    return Sources(**resolved)


def detect_header_row(raw: pd.DataFrame) -> int:
    max_scan = min(30, len(raw) - 1)
    for idx in range(max_scan):
        cell = str(raw.iloc[idx, 0]).strip()
        next_cell = pd.to_numeric(raw.iloc[idx + 1, 0], errors="coerce")
        if K_NO in cell and pd.notna(next_cell):
            return idx
    # fallback: first row where next row starts with number
    for idx in range(max_scan):
        next_cell = pd.to_numeric(raw.iloc[idx + 1, 0], errors="coerce")
        curr_cell_num = pd.to_numeric(raw.iloc[idx, 0], errors="coerce")
        if pd.notna(next_cell) and pd.isna(curr_cell_num):
            return idx
    raise ValueError("header row not found")


def find_column(columns: List[str], keywords: List[str], required: bool = True) -> str | None:
    for keyword in keywords:
        for col in columns:
            if keyword in col:
                return col
    if required:
        raise ValueError(f"required column not found. keywords={keywords}, columns={columns}")
    return None


def parse_week(value) -> int:
    if pd.isna(value):
        return -1
    text = str(value).strip()
    m = re.search(r"(\d+)\s*" + K_WEEK_SUFFIX, text)
    if m:
        return int(m.group(1))
    if K_EDU_BEFORE in text:
        return 0
    if K_TOTAL in text:
        return -1
    return -1


def normalize_category(raw_category: str, detail: str) -> str:
    text = f"{raw_category} {detail}".replace(" ", "")
    for _, mapped, keywords in CATEGORY_RULES:
        if any(k in text for k in keywords):
            return mapped
    return "\uae30\ud0c0"


def load_settlement_details(path: Path, cohort_label: str) -> pd.DataFrame:
    xl = pd.ExcelFile(path)
    sheet_index = 3 if len(xl.sheet_names) >= 6 else 2
    raw = pd.read_excel(path, sheet_name=sheet_index, header=None)
    header_row = detect_header_row(raw)

    headers = [str(v).strip() if pd.notna(v) else f"col_{i}" for i, v in enumerate(raw.iloc[header_row].tolist())]
    df = raw.iloc[header_row + 1 :].copy()
    df.columns = headers
    columns = [str(c) for c in df.columns]

    number_col = find_column(columns, [K_NO])
    amount_col = find_column(columns, [K_AMOUNT])
    week_col = find_column(columns, [K_WEEK])
    detail_col = find_column(columns, [K_DETAIL])
    raw_category_col = find_column(columns, [K_CATEGORY])
    vendor_col = find_column(columns, [K_VENDOR], required=False)
    date_col = find_column(columns, [K_DATE], required=False)

    df = df[pd.to_numeric(df[number_col], errors="coerce").notna()].copy()
    df["\ubc88\ud638"] = pd.to_numeric(df[number_col], errors="coerce").astype(int)
    df["\uae08\uc561"] = pd.to_numeric(df[amount_col], errors="coerce").fillna(0).astype(int)
    df["\ucc28\uc218"] = df[week_col].fillna("").astype(str).str.strip()
    df["\uc8fc\ucc28"] = df["\ucc28\uc218"].apply(parse_week)
    df["\ub0b4\uc5ed"] = df[detail_col].fillna("").astype(str).str.strip()
    df["\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8"] = (
        df[raw_category_col].fillna(K_UNCLASSIFIED).astype(str).str.strip().replace("", K_UNCLASSIFIED)
    )
    df["\ube44\uad50\uce74\ud14c\uace0\ub9ac"] = df.apply(
        lambda row: normalize_category(row["\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8"], row["\ub0b4\uc5ed"]),
        axis=1,
    )
    if vendor_col:
        df["\uac70\ub798\ucc98"] = df[vendor_col].fillna("").astype(str).str.strip()
    else:
        df["\uac70\ub798\ucc98"] = ""
    if date_col:
        df["\uc77c\uc790"] = pd.to_datetime(df[date_col], errors="coerce")
    else:
        df["\uc77c\uc790"] = pd.NaT

    df["\uae30\uc218"] = cohort_label

    return df[
        [
            "\uae30\uc218",
            "\ubc88\ud638",
            "\uc77c\uc790",
            "\ucc28\uc218",
            "\uc8fc\ucc28",
            "\uae08\uc561",
            "\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8",
            "\ube44\uad50\uce74\ud14c\uace0\ub9ac",
            "\uac70\ub798\ucc98",
            "\ub0b4\uc5ed",
        ]
    ].reset_index(drop=True)


def load_budget(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name=1, header=None)
    table = raw.iloc[2:, 0:3].copy()
    table.columns = [K_BUDGET_SECTION, K_AMOUNT, K_BUDGET_DETAIL]

    table[K_BUDGET_SECTION] = table[K_BUDGET_SECTION].fillna("").astype(str)
    table[K_AMOUNT] = pd.to_numeric(table[K_AMOUNT], errors="coerce")

    top_level = table[
        (table[K_BUDGET_SECTION].str.strip() != "")
        & (table[K_AMOUNT].notna())
        & (~table[K_BUDGET_SECTION].str.startswith(" "))
        & (table[K_BUDGET_SECTION].str.strip() != K_SUM)
    ].copy()

    top_level[K_BUDGET_SECTION] = top_level[K_BUDGET_SECTION].str.strip()
    top_level[K_AMOUNT] = top_level[K_AMOUNT].astype(int)
    top_level["\ube44\uad50\uce74\ud14c\uace0\ub9ac"] = top_level[K_BUDGET_SECTION].apply(
        lambda x: normalize_category(x, "")
    )
    return top_level[[K_BUDGET_SECTION, K_AMOUNT, "\ube44\uad50\uce74\ud14c\uace0\ub9ac"]]


def load_income_summary(path: Path) -> dict:
    raw = pd.read_excel(path, sheet_name=1, header=None)
    header_row = 2 if len(raw) > 2 else 0
    headers = [str(v).strip() if pd.notna(v) else f"col_{i}" for i, v in enumerate(raw.iloc[header_row].tolist())]
    df = raw.iloc[header_row + 1 :].copy()
    df.columns = headers
    columns = [str(c) for c in df.columns]

    amount_col = next((c for c in columns if "금액" in c), columns[0])
    name_col = next((c for c in columns if "내역" in c), columns[1] if len(columns) > 1 else columns[0])
    detail_col = next((c for c in columns if "내용" in c), columns[2] if len(columns) > 2 else columns[-1])

    df = df[pd.to_numeric(df[amount_col], errors="coerce").notna()].copy()
    df["금액"] = pd.to_numeric(df[amount_col], errors="coerce").astype(int)
    df["내역"] = df[name_col].fillna("").astype(str).str.strip()
    df["내용"] = df[detail_col].fillna("").astype(str).str.strip()
    df = df[df["내역"] != ""].copy()

    summary = (
        df.groupby("내용", as_index=False)["금액"]
        .sum()
        .sort_values("금액", ascending=False)
        .reset_index(drop=True)
    )
    income_rows = df.sort_values("금액", ascending=False).reset_index(drop=True)

    return {
        "total": int(df["금액"].sum()),
        "summary": [
            {"category": str(r["내용"]) if str(r["내용"]) else "기타", "amount": int(r["금액"])}
            for _, r in summary.iterrows()
        ],
        "rows": [
            {
                "name": str(r["내역"]),
                "category": str(r["내용"]) if str(r["내용"]) else "기타",
                "amount": int(r["금액"]),
            }
            for _, r in income_rows.iterrows()
        ],
    }


def money(value: int) -> int:
    return int(value)


def resolve_attendance_file() -> Path | None:
    for p in ATTENDANCE_CANDIDATES:
        if p.exists():
            return p
    return None


def load_attendance(path: Path | None, settlement_4th_path: Path | None = None) -> dict:
    source_path = settlement_4th_path if settlement_4th_path and settlement_4th_path.exists() else path
    if source_path is None:
        return {"available": False, "weekly": [], "members_all": []}

    xl = pd.ExcelFile(source_path)
    if len(xl.sheet_names) >= 6:
        member_raw = pd.read_excel(source_path, sheet_name=5)
        member_raw.columns = [str(column).strip().strip("'") for column in member_raw.columns]
        week_columns = member_raw.columns[4:8].tolist()
        attendance_rows = member_raw.copy()
        attendance_rows = attendance_rows[pd.to_numeric(attendance_rows.iloc[:, 8], errors="coerce").notna()].copy()
        attendance_rows["attend_count"] = pd.to_numeric(attendance_rows.iloc[:, 8], errors="coerce").fillna(0).astype(int)
        attendance_rows["check_count"] = pd.to_numeric(attendance_rows.iloc[:, 9], errors="coerce").fillna(0).astype(int)
        attendance_rows["rate"] = pd.to_numeric(attendance_rows.iloc[:, 10], errors="coerce").fillna(0.0).astype(float)
        attendance_rows["name"] = attendance_rows.iloc[:, 2].fillna("").astype(str).str.strip()
        attendance_rows["company"] = attendance_rows.iloc[:, 1].fillna("").astype(str).str.strip()
        attendance_rows = attendance_rows[attendance_rows["check_count"] > 0].copy()

        weekly_rows = []
        for column in week_columns:
            text = str(column)
            match = re.search(r"(\d+)", text)
            if not match:
                continue
            week_num = int(match.group(1))
            values = attendance_rows[column].fillna("").astype(str).str.strip()
            attend_count = int(values.isin(["출석", "참석"]).sum())
            absent_count = int(values.isin(["불참"]).sum())
            checked = attend_count + absent_count
            rate = (attend_count / checked) if checked else 0.0
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
            weekly_rows.append(
                {
                    "week": week_num,
                    "week_label": f"{week_num}주차",
                    "date": date_match.group(1) if date_match else "",
                    "attend": attend_count,
                    "absent": absent_count,
                    "rate": float(rate),
                }
            )
        weekly_rows.sort(key=lambda item: item["week"])

        members_all = [
            {
                "name": row["name"],
                "company": row["company"],
                "attend_count": int(row["attend_count"]),
                "check_count": int(row["check_count"]),
                "rate": float(row["rate"]),
            }
            for _, row in attendance_rows.sort_values(["rate", "attend_count", "name"], ascending=[True, True, True]).iterrows()
        ]

        return {
            "available": True,
            "source_file": source_path.name,
            "weekly": weekly_rows,
            "members_all": members_all,
        }
        cols = list(member_raw.columns)
        name_col = next((c for c in cols if "??" in str(c)), cols[2] if len(cols) > 2 else cols[0])
        company_col = next((c for c in cols if "??" in str(c)), cols[1] if len(cols) > 1 else cols[0])
        attend_count_col = next((c for c in cols if "????" in str(c)), None)
        check_count_col = next((c for c in cols if "????" in str(c) or "??????" in str(c)), None)
        rate_col = next((c for c in cols if "???" in str(c)), None)
        week_cols = [c for c in cols if re.search(r"\d+\s*?", str(c))]

        if attend_count_col is None:
            return {"available": False, "weekly": [], "members_all": []}

        m = member_raw.copy()
        m = m[pd.to_numeric(m[attend_count_col], errors="coerce").notna()].copy()
        m["attend_count"] = pd.to_numeric(m[attend_count_col], errors="coerce").fillna(0).astype(int)
        if check_count_col is not None:
            m["check_count"] = pd.to_numeric(m[check_count_col], errors="coerce").fillna(0).astype(int)
        else:
            m["check_count"] = 0
        if rate_col is not None:
            m["rate"] = pd.to_numeric(m[rate_col], errors="coerce").fillna(0.0).astype(float)
        else:
            m["rate"] = m.apply(lambda r: (r["attend_count"] / r["check_count"]) if r["check_count"] else 0.0, axis=1)
        m["name"] = m[name_col].fillna("").astype(str).str.strip()
        m["company"] = m[company_col].fillna("").astype(str).str.strip()
        m = m[m["check_count"] > 0].copy()

        weekly_rows = []
        for c in week_cols:
            text = str(c)
            num_match = re.search(r"(\d+)", text)
            if not num_match:
                continue
            week_num = int(num_match.group(1))
            vals = m[c].fillna("").astype(str).str.strip()
            attend_cnt = int(vals.isin(["??", "??"]).sum())
            absent_cnt = int(vals.isin(["??"]).sum())
            checked = attend_cnt + absent_cnt
            rate = (attend_cnt / checked) if checked else 0.0
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
            weekly_rows.append(
                {
                    "week": week_num,
                    "week_label": f"{week_num}??",
                    "date": date_match.group(1) if date_match else "",
                    "attend": attend_cnt,
                    "absent": absent_cnt,
                    "rate": float(rate),
                }
            )
        weekly_rows.sort(key=lambda x: x["week"])

        members_all = [
            {
                "name": r["name"],
                "company": r["company"],
                "attend_count": int(r["attend_count"]),
                "check_count": int(r["check_count"]),
                "rate": float(r["rate"]),
            }
            for _, r in m.sort_values(["rate", "attend_count", "name"], ascending=[True, True, True]).iterrows()
        ]

        return {
            "available": True,
            "source_file": source_path.name,
            "weekly": weekly_rows,
            "members_all": members_all,
        }

    if "회차별 출석현황" in xl.sheet_names:
        member_raw = pd.read_excel(source_path, sheet_name="회차별 출석현황")
    elif "개인별출석" in xl.sheet_names:
        member_raw = pd.read_excel(source_path, sheet_name="개인별출석")
    else:
        return {"available": False, "weekly": [], "members_all": []}

    cols = list(member_raw.columns)
    name_col = next((c for c in cols if "성명" in str(c)), cols[2] if len(cols) > 2 else cols[0])
    company_col = next((c for c in cols if "업체" in str(c)), cols[1] if len(cols) > 1 else cols[0])
    attend_count_col = next((c for c in cols if "출석횟수" in str(c)), None)
    check_count_col = next((c for c in cols if "확인회차" in str(c) or "확인가능회차" in str(c)), None)
    rate_col = next((c for c in cols if "출석률" in str(c)), None)
    week_cols = [c for c in cols if re.search(r"\d+\s*주", str(c))]

    if attend_count_col is None:
        return {"available": False, "weekly": [], "members_all": []}

    m = member_raw.copy()
    m = m[pd.to_numeric(m[attend_count_col], errors="coerce").notna()].copy()
    m["attend_count"] = pd.to_numeric(m[attend_count_col], errors="coerce").fillna(0).astype(int)
    if check_count_col is not None:
        m["check_count"] = pd.to_numeric(m[check_count_col], errors="coerce").fillna(0).astype(int)
    else:
        m["check_count"] = 0
    if rate_col is not None:
        m["rate"] = pd.to_numeric(m[rate_col], errors="coerce").fillna(0.0).astype(float)
    else:
        m["rate"] = m.apply(lambda r: (r["attend_count"] / r["check_count"]) if r["check_count"] else 0.0, axis=1)
    m["name"] = m[name_col].fillna("").astype(str).str.strip()
    m["company"] = m[company_col].fillna("").astype(str).str.strip()

    # 확인회차가 0인 행은 아직 집계대상이 아니므로 제외
    m = m[m["check_count"] > 0].copy()

    weekly_rows = []
    for c in week_cols:
        text = str(c)
        num_match = re.search(r"(\d+)", text)
        if not num_match:
            continue
        week_num = int(num_match.group(1))
        vals = m[c].fillna("").astype(str).str.strip()
        attend_cnt = int(vals.isin(["출석", "참석"]).sum())
        absent_cnt = int(vals.isin(["불참"]).sum())
        checked = attend_cnt + absent_cnt
        rate = (attend_cnt / checked) if checked else 0.0
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
        weekly_rows.append(
            {
                "week": week_num,
                "week_label": f"{week_num}주차",
                "date": date_match.group(1) if date_match else "",
                "attend": attend_cnt,
                "absent": absent_cnt,
                "rate": float(rate),
            }
        )
    weekly_rows.sort(key=lambda x: x["week"])

    members_all = [
        {
            "name": r["name"],
            "company": r["company"],
            "attend_count": int(r["attend_count"]),
            "check_count": int(r["check_count"]),
            "rate": float(r["rate"]),
        }
        for _, r in m.sort_values(["rate", "attend_count", "name"], ascending=[True, True, True]).iterrows()
    ]

    return {
        "available": True,
        "source_file": source_path.name,
        "weekly": weekly_rows,
        "members_all": members_all,
    }


def build_payload(
    df_prev: pd.DataFrame,
    df_curr: pd.DataFrame,
    income: dict,
    attendance: dict,
    source_files: Dict[str, str],
) -> dict:
    completed_weeks = sorted([int(w) for w in df_curr.loc[df_curr["\uc8fc\ucc28"] > 0, "\uc8fc\ucc28"].unique().tolist()])
    if not completed_weeks:
        raise ValueError("no completed week data found in 4th settlement")

    max_week = max(completed_weeks)

    weekly_rows = []
    for week in completed_weeks:
        prev_amt = int(df_prev.loc[df_prev["\uc8fc\ucc28"] == week, "\uae08\uc561"].sum())
        curr_amt = int(df_curr.loc[df_curr["\uc8fc\ucc28"] == week, "\uae08\uc561"].sum())
        diff = curr_amt - prev_amt
        diff_rate = (diff / prev_amt) if prev_amt else 0.0
        weekly_rows.append(
            {
                "week": week,
                "week_label": f"{week}{K_WEEK_LABEL}",
                "prev_amount": money(prev_amt),
                "current_amount": money(curr_amt),
                "diff_amount": money(diff),
                "diff_rate": diff_rate,
            }
        )

    category_prev = (
        df_prev[df_prev["\uc8fc\ucc28"].isin(completed_weeks)]
        .groupby("\ube44\uad50\uce74\ud14c\uace0\ub9ac", as_index=False)["\uae08\uc561"]
        .sum()
        .rename(columns={"\uae08\uc561": "prev_amount"})
    )
    category_curr = (
        df_curr[df_curr["\uc8fc\ucc28"].isin(completed_weeks)]
        .groupby("\ube44\uad50\uce74\ud14c\uace0\ub9ac", as_index=False)["\uae08\uc561"]
        .sum()
        .rename(columns={"\uae08\uc561": "current_amount"})
    )
    category_comp = category_prev.merge(category_curr, on="\ube44\uad50\uce74\ud14c\uace0\ub9ac", how="outer").fillna(0)
    category_comp["prev_amount"] = category_comp["prev_amount"].astype(int)
    category_comp["current_amount"] = category_comp["current_amount"].astype(int)
    category_comp["diff_amount"] = category_comp["current_amount"] - category_comp["prev_amount"]
    category_comp["diff_rate"] = category_comp.apply(
        lambda r: (r["diff_amount"] / r["prev_amount"]) if r["prev_amount"] else 0.0, axis=1
    )
    category_comp = category_comp.sort_values("current_amount", ascending=False).reset_index(drop=True)

    spent_curr = int(df_curr[df_curr["\uc8fc\ucc28"].isin(completed_weeks)]["\uae08\uc561"].sum())
    spent_prev = int(df_prev[df_prev["\uc8fc\ucc28"].isin(completed_weeks)]["\uae08\uc561"].sum())
    diff_total = spent_curr - spent_prev
    diff_rate_total = (diff_total / spent_prev) if spent_prev else 0.0

    total_budget = int(income["total"])
    remaining_budget = total_budget - spent_curr
    budget_usage_rate = (spent_curr / total_budget) if total_budget else 0.0

    top_rows = (
        df_curr[df_curr["\uc8fc\ucc28"].isin(completed_weeks)]
        .sort_values("\uae08\uc561", ascending=False)
        .head(15)
        .copy()
    )
    top_rows["\uc77c\uc790"] = top_rows["\uc77c\uc790"].dt.strftime("%Y-%m-%d").fillna("")
    current_rows = (
        df_curr[df_curr["\uc8fc\ucc28"].isin(completed_weeks)]
        .sort_values(["\uc8fc\ucc28", "\uae08\uc561"], ascending=[True, False])
        .copy()
    )
    current_rows["\uc77c\uc790"] = current_rows["\uc77c\uc790"].dt.strftime("%Y-%m-%d").fillna("")
    prev_rows = (
        df_prev[df_prev["\uc8fc\ucc28"].isin(completed_weeks)]
        .sort_values(["\uc8fc\ucc28", "\uae08\uc561"], ascending=[True, False])
        .copy()
    )
    prev_rows["\uc77c\uc790"] = prev_rows["\uc77c\uc790"].dt.strftime("%Y-%m-%d").fillna("")

    payload = {
        "meta": {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "completed_week_range": f"1~{max_week}{K_WEEK_LABEL}",
            "completed_weeks": completed_weeks,
            "source_files": source_files,
        },
        "kpis": {
            "income_total": money(total_budget),
            "spent_current": money(spent_curr),
            "spent_prev_same_period": money(spent_prev),
            "diff_amount": money(diff_total),
            "diff_rate": diff_rate_total,
            "budget_usage_rate": budget_usage_rate,
            "remaining_budget": money(remaining_budget),
        },
        "weekly_comparison": weekly_rows,
        "category_comparison": [
            {
                "category": str(r["\ube44\uad50\uce74\ud14c\uace0\ub9ac"]),
                "prev_amount": money(r["prev_amount"]),
                "current_amount": money(r["current_amount"]),
                "diff_amount": money(r["diff_amount"]),
                "diff_rate": float(r["diff_rate"]),
            }
            for _, r in category_comp.iterrows()
        ],
        "budget_vs_actual": [
            {
                "category": "실수입 총액",
                "budget": money(total_budget),
                "spent": money(spent_curr),
                "remain": money(remaining_budget),
                "usage_rate": float(budget_usage_rate),
            }
        ],
        "income_summary": income["summary"],
        "income_rows": income["rows"],
        "top_transactions": [
            {
                "week_label": str(r["\ucc28\uc218"]),
                "date": str(r["\uc77c\uc790"]),
                "category": str(r["\ube44\uad50\uce74\ud14c\uace0\ub9ac"]),
                "raw_category": str(r["\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8"]),
                "vendor": str(r["\uac70\ub798\ucc98"]),
                "detail": str(r["\ub0b4\uc5ed"]),
                "amount": money(r["\uae08\uc561"]),
            }
            for _, r in top_rows.iterrows()
        ],
        "current_transactions": [
            {
                "week_label": str(r["\ucc28\uc218"]),
                "date": str(r["\uc77c\uc790"]),
                "category": str(r["\ube44\uad50\uce74\ud14c\uace0\ub9ac"]),
                "raw_category": str(r["\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8"]),
                "vendor": str(r["\uac70\ub798\ucc98"]),
                "detail": str(r["\ub0b4\uc5ed"]),
                "amount": money(r["\uae08\uc561"]),
            }
            for _, r in current_rows.iterrows()
        ],
        "prev_transactions": [
            {
                "week_label": str(r["\ucc28\uc218"]),
                "date": str(r["\uc77c\uc790"]),
                "category": str(r["\ube44\uad50\uce74\ud14c\uace0\ub9ac"]),
                "raw_category": str(r["\uce74\ud14c\uace0\ub9ac\uc6d0\ubcf8"]),
                "vendor": str(r["\uac70\ub798\ucc98"]),
                "detail": str(r["\ub0b4\uc5ed"]),
                "amount": money(r["\uae08\uc561"]),
            }
            for _, r in prev_rows.iterrows()
        ],
        "attendance": attendance,
    }
    return payload


if __name__ == "__main__":
    sources = resolve_sources()
    prev_df = load_settlement_details(sources.settlement_3rd, "3\uae30")
    curr_df = load_settlement_details(sources.settlement_4th, "4\uae30")
    income = load_income_summary(sources.settlement_4th)
    attendance = load_attendance(resolve_attendance_file(), sources.settlement_4th)

    data = build_payload(
        prev_df,
        curr_df,
        income,
        attendance,
        {
            "settlement_3rd": sources.settlement_3rd.name,
            "settlement_4th": sources.settlement_4th.name,
            "budget_4th": sources.budget_4th.name,
        },
    )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(data, ensure_ascii=False, indent=2)
    OUTPUT_JSON.write_text(json_text, encoding="utf-8")
    OUTPUT_JS.write_text(f"window.DASHBOARD_DATA = {json_text};\n", encoding="utf-8")
    print(f"[DONE] {OUTPUT_JSON}")
    print(f"[DONE] {OUTPUT_JS}")
