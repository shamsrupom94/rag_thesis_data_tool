from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("RAG_REVIEWER_DATA_DIR", ROOT / "data")).resolve()
SECTIONS_DIR = DATA_DIR / "acad_rag_sect_docs"
QNA_DIR = DATA_DIR / "qna_dataset"
PDF_DIR = DATA_DIR / "academic_pdf"
EXTRACTED_DIR = DATA_DIR / "academic_extracted"
SECTIONIZED_PATH = DATA_DIR / "academic_rag_sectionized.jsonl"
WRITE_LOCK = Lock()

app = FastAPI(title="RAG Q&A Reviewer API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RelevantSection(BaseModel):
    section_id: str
    section_heading: str
    sec_char_start: int = Field(ge=0)
    sec_char_end: int = Field(ge=0)
    evidence_sentence: str

class QnAInput(BaseModel):
    question: str = Field(min_length=1)
    answer_exact: str = Field(min_length=1)
    answer_llm: str = ""
    answer_type: Literal["facts", "results", "methods", "definitions", "comparisons", "analysis"] = "facts"
    relevant_sections: list[RelevantSection] = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    status: Literal["unverified", "verified", "needs_revision"] = "unverified"


def read_json(path: Path) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
        if not isinstance(value, list):
            raise ValueError("expected a JSON array")
        return value
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(500, f"Could not read {path.name}: {exc}") from exc


def write_json_atomic(path: Path, value: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with WRITE_LOCK:
        try:
            fd, temporary = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".json", dir=path.parent)
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            os.replace(temporary, path)
        except OSError as exc:
            raise HTTPException(500, f"Could not save {path.name}: {exc}") from exc


def clean_title(title: str) -> str:
    return re.sub(r"^\s*#+\s*", "", title).strip()


def section_path(doc_id: str) -> Path:
    if not re.fullmatch(r"acad_\d+", doc_id):
        raise HTTPException(404, "Document not found")
    path = SECTIONS_DIR / f"{doc_id}_sections.json"
    if not path.is_file():
        raise HTTPException(404, "Document not found")
    return path


def qna_path(doc_id: str) -> Path:
    section_path(doc_id)
    return QNA_DIR / f"{doc_id}_sections_qna.json"


def get_qnas(doc_id: str) -> list[dict[str, Any]]:
    path = qna_path(doc_id)
    return read_json(path) if path.is_file() else []


def resolve_pdf(doc_id: str, sections: list[dict[str, Any]]) -> Path | None:
    # Extracted markdown names carry the exact PDF stem after the document id.
    source_path = str(sections[0].get("source", {}).get("file_path", "")) if sections else ""
    markdown_stem = Path(source_path.replace("\\", "/")).stem
    candidate_stem = re.sub(rf"^{re.escape(doc_id)}_", "", markdown_stem)
    candidate = PDF_DIR / f"{candidate_stem}.pdf"
    if candidate.is_file():
        return candidate

    number = int(doc_id.split("_")[1]) - 1
    matches = sorted(PDF_DIR.glob(f"{number:03d}_*.pdf"))
    return matches[0] if matches else None


def resolve_extracted_markdown(doc_id: str, sections: list[dict[str, Any]]) -> Path | None:
    source_path = str(sections[0].get("source", {}).get("file_path", "")) if sections else ""
    if not source_path:
        return None

    path = Path(source_path.replace("\\", "/"))
    path = (path if path.is_absolute() else ROOT / path).resolve()
    extracted_root = EXTRACTED_DIR.resolve()
    if not path.is_relative_to(extracted_root) or path.suffix.lower() != ".md" or not path.name.startswith(f"{doc_id}_"):
        raise HTTPException(500, f"Unsafe extracted markdown path for {doc_id}")
    return path if path.is_file() else None


def filter_sectionized_jsonl(doc_id: str) -> tuple[str | None, int]:
    if not SECTIONIZED_PATH.is_file():
        return None, 0
    kept_lines: list[str] = []
    removed_count = 0
    try:
        with SECTIONIZED_PATH.open("r", encoding="utf-8-sig") as handle:
            for line in handle:
                if not line.strip():
                    continue
                item = json.loads(line)
                if item.get("doc_id") == doc_id:
                    removed_count += 1
                else:
                    kept_lines.append(json.dumps(item, ensure_ascii=False) + "\n")
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, f"Could not update {SECTIONIZED_PATH.name}: {exc}") from exc
    return "".join(kept_lines), removed_count


def write_text_atomic_unlocked(path: Path, value: str) -> None:
    temporary = ""
    try:
        fd, temporary = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=path.suffix, dir=path.parent)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
        os.replace(temporary, path)
    except OSError as exc:
        if temporary:
            Path(temporary).unlink(missing_ok=True)
        raise HTTPException(500, f"Could not update {path.name}: {exc}") from exc


def document_summary(path: Path) -> dict[str, Any] | None:
    sections = read_json(path)
    if not sections:
        return None
    doc_id = sections[0]["doc_id"]
    qnas = get_qnas(doc_id)
    counts = {"verified": 0, "unverified": 0, "needs_revision": 0}
    for item in qnas:
        item_status = item.get("status", "unverified")
        counts[item_status if item_status in counts else "unverified"] += 1
    return {
        "doc_id": doc_id,
        "doc_title": clean_title(sections[0].get("doc_title", doc_id)),
        "section_count": len(sections),
        "qna_count": len(qnas),
        "status_counts": counts,
        "has_pdf": resolve_pdf(doc_id, sections) is not None,
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/documents")
def list_documents() -> list[dict[str, Any]]:
    if not SECTIONS_DIR.is_dir():
        raise HTTPException(500, f"Sections directory not found: {SECTIONS_DIR}")
    documents = [document_summary(path) for path in sorted(SECTIONS_DIR.glob("acad_*_sections.json"))]
    return [document for document in documents if document is not None]


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str) -> dict[str, Any]:
    sections = read_json(section_path(doc_id))
    summary = document_summary(section_path(doc_id))
    return {**(summary or {}), "sections": sections, "qnas": get_qnas(doc_id), "pdf_url": f"/api/documents/{doc_id}/pdf" if resolve_pdf(doc_id, sections) else None}


@app.get("/api/documents/{doc_id}/pdf")
def get_pdf(doc_id: str) -> FileResponse:
    sections = read_json(section_path(doc_id))
    pdf = resolve_pdf(doc_id, sections)
    if not pdf:
        raise HTTPException(404, "PDF not found")
    return FileResponse(pdf, media_type="application/pdf", filename=pdf.name, content_disposition_type="inline")


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str) -> dict[str, Any]:
    sections_path = section_path(doc_id)
    sections = read_json(sections_path)
    related_paths = [
        qna_path(doc_id),
        resolve_extracted_markdown(doc_id, sections),
        resolve_pdf(doc_id, sections),
        sections_path,
    ]
    removed: list[str] = []
    sectionized_content, removed_sectionized_rows = filter_sectionized_jsonl(doc_id)

    # Delete the section index last so a partial failure does not hide the document.
    with WRITE_LOCK:
        if sectionized_content is not None and removed_sectionized_rows:
            write_text_atomic_unlocked(SECTIONIZED_PATH, sectionized_content)
        for path in related_paths:
            if path is None or not path.is_file():
                continue
            try:
                path.unlink()
                removed.append(str(path.relative_to(DATA_DIR)))
            except OSError as exc:
                raise HTTPException(500, f"Could not delete {path.name}: {exc}") from exc

    return {
        "doc_id": doc_id,
        "deleted_files": removed,
        "removed_sectionized_rows": removed_sectionized_rows,
    }


def checked_payload(doc_id: str, payload: QnAInput) -> dict[str, Any]:
    sections = read_json(section_path(doc_id))
    section_map = {item["section_id"]: item for item in sections}
    for reference in payload.relevant_sections:
        section = section_map.get(reference.section_id)
        if not section:
            raise HTTPException(422, f"Unknown section: {reference.section_id}")
        if reference.sec_char_end < reference.sec_char_start or reference.sec_char_end > len(section.get("text", "")):
            raise HTTPException(422, f"Invalid evidence offsets for {reference.section_id}")
    return payload.model_dump()


@app.post("/api/documents/{doc_id}/qnas", status_code=status.HTTP_201_CREATED)
def create_qna(doc_id: str, payload: QnAInput) -> dict[str, Any]:
    values = checked_payload(doc_id, payload)
    sections = read_json(section_path(doc_id))
    qnas = get_qnas(doc_id)
    section_id = values["relevant_sections"][0]["section_id"]
    existing_numbers = []
    for item in qnas:
        match = re.fullmatch(rf"{re.escape(section_id)}_q(\d+)", item.get("qid", ""))
        if match:
            existing_numbers.append(int(match.group(1)))
    qid = f"{section_id}_q{max(existing_numbers, default=0) + 1:03d}"
    item = {
        "qid": qid,
        "domain": "academic-rag",
        "doc_id": doc_id,
        "doc_title": sections[0].get("doc_title", doc_id),
        **values,
        "source": sections[0].get("source", {}),
        "created_by": "reviewer",
    }
    qnas.append(item)
    write_json_atomic(qna_path(doc_id), qnas)
    return item


@app.put("/api/documents/{doc_id}/qnas/{qid}")
def update_qna(doc_id: str, qid: str, payload: QnAInput) -> dict[str, Any]:
    values = checked_payload(doc_id, payload)
    qnas = get_qnas(doc_id)
    index = next((index for index, item in enumerate(qnas) if item.get("qid") == qid), None)
    if index is None:
        raise HTTPException(404, "Q&A pair not found")
    qnas[index] = {**qnas[index], **values, "qid": qid, "doc_id": doc_id}
    write_json_atomic(qna_path(doc_id), qnas)
    return qnas[index]


@app.delete("/api/documents/{doc_id}/qnas/{qid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_qna(doc_id: str, qid: str) -> Response:
    qnas = get_qnas(doc_id)
    updated = [item for item in qnas if item.get("qid") != qid]
    if len(updated) == len(qnas):
        raise HTTPException(404, "Q&A pair not found")
    write_json_atomic(qna_path(doc_id), updated)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
