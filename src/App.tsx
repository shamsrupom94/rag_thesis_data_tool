import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronRight, CircleAlert, ExternalLink, FileText, Library, LoaderCircle, Plus, Save, Search, Sparkles, Trash2, X } from "lucide-react";
import { api } from "./api";
import type { DocumentDetail, DocumentSummary, QnA, ReviewStatus, Section } from "./types";

type SourceTab = "section" | "pdf";
const answerTypes = ["facts", "results", "methods", "definitions", "comparisons", "analysis"] as const;

function statusLabel(value: ReviewStatus) {
  if (value === "verified") return "Reviewed";
  if (value === "needs_revision") return "Needs revision";
  return "Not reviewed";
}

function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [selectedQid, setSelectedQid] = useState("");
  const [draft, setDraft] = useState<QnA | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [sourceTab, setSourceTab] = useState<SourceTab>("section");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isNew, setIsNew] = useState(false);

  const refreshDocuments = () => api.documents().then(setDocuments);

  useEffect(() => {
    refreshDocuments().then(() => setLoading(false)).catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selectedDoc && documents.length) setSelectedDoc(documents[0].doc_id);
  }, [documents, selectedDoc]);

  useEffect(() => {
    if (!selectedDoc) return;
    setLoading(true);
    api.document(selectedDoc).then((value) => {
      setDocument(value);
      setSelectedQid(value.qnas[0]?.qid || "");
      setDraft(value.qnas[0] ? structuredClone(value.qnas[0]) : null);
      setIsNew(false);
      setLoading(false);
    }).catch((err) => { setError(err.message); setLoading(false); });
  }, [selectedDoc]);

  const visibleQnas = useMemo(() => (document?.qnas || []).filter((qna) => {
    const matchesFilter = filter === "all" || (qna.status || "unverified") === filter;
    const text = `${qna.question} ${qna.tags.join(" ")} ${qna.qid}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  }), [document, filter, query]);

  const selectedSection = useMemo(() => {
    const id = draft?.relevant_sections[0]?.section_id;
    return document?.sections.find((section) => section.section_id === id) || document?.sections[0] || null;
  }, [document, draft]);

  function chooseQna(qna: QnA) {
    setSelectedQid(qna.qid); setDraft(structuredClone(qna)); setIsNew(false); setSourceTab("section"); setNotice("");
  }

  function startNew() {
    if (!document?.sections.length) return;
    const section = document.sections[0];
    setDraft({ qid: "New", domain: "academic-rag", doc_id: document.doc_id, doc_title: document.doc_title, question: "", answer_exact: "", answer_llm: "", answer_type: "facts", relevant_sections: [{ section_id: section.section_id, section_heading: section.section_heading, sec_char_start: 0, sec_char_end: 0, evidence_sentence: "" }], source: section.source, created_by: "reviewer", status: "unverified", tags: [], difficulty: "medium" });
    setSelectedQid(""); setIsNew(true); setSourceTab("section");
  }

  function patchDraft(values: Partial<QnA>) { setDraft((current) => current ? { ...current, ...values } : current); }

  function setSection(section: Section) {
    if (!draft) return;
    patchDraft({ relevant_sections: [{ section_id: section.section_id, section_heading: section.section_heading, sec_char_start: 0, sec_char_end: 0, evidence_sentence: "" }, ...draft.relevant_sections.slice(1)] });
  }

  function setEvidence(value: string) {
    if (!draft || !selectedSection) return;
    const start = value ? selectedSection.text.indexOf(value) : 0;
    const reference = { ...draft.relevant_sections[0], evidence_sentence: value, sec_char_start: Math.max(0, start), sec_char_end: start >= 0 ? start + value.length : 0 };
    patchDraft({ relevant_sections: [reference, ...draft.relevant_sections.slice(1)] });
  }

  async function save() {
    if (!document || !draft) return;
    setSaving(true); setError("");
    try {
      const saved = isNew ? await api.create(document.doc_id, draft) : await api.update(document.doc_id, draft.qid, draft);
      const fresh = await api.document(document.doc_id);
      setDocument(fresh); setDraft(structuredClone(saved)); setSelectedQid(saved.qid); setIsNew(false);
      await refreshDocuments(); setNotice("Saved to the local dataset");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!document || !draft || isNew || !window.confirm(`Delete ${draft.qid}? This will update the local JSON file.`)) return;
    setSaving(true);
    try {
      await api.remove(document.doc_id, draft.qid);
      const fresh = await api.document(document.doc_id); setDocument(fresh);
      const next = fresh.qnas[0] || null; setDraft(next ? structuredClone(next) : null); setSelectedQid(next?.qid || "");
      await refreshDocuments(); setNotice("Q&A pair deleted");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete"); }
    finally { setSaving(false); }
  }

  async function removeDocument() {
    if (!document || !window.confirm(`Delete "${document.doc_title}"?\n\nThis permanently deletes its sections, Q&A, extracted Markdown, and PDF files.`)) return;
    setDeletingDocument(true); setError(""); setNotice("");
    try {
      const currentIndex = documents.findIndex((item) => item.doc_id === document.doc_id);
      const result = await api.deleteDocument(document.doc_id);
      const freshDocuments = await api.documents();
      const nextDocument = freshDocuments[Math.min(currentIndex, freshDocuments.length - 1)] || null;
      setDocuments(freshDocuments); setDocument(null); setDraft(null); setSelectedQid(""); setIsNew(false);
      setSelectedDoc(nextDocument?.doc_id || "");
      setNotice(`Document deleted (${result.deleted_files.length} files)`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete document"); }
    finally { setDeletingDocument(false); }
  }

  if (loading && !documents.length) return <div className="loading-screen"><LoaderCircle className="spin" /><span>Opening your review desk…</span></div>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><strong>Rivewer</strong><span>RAG Q&A Dataset Reviewer Tool</span></div></div>
      <div className="top-stats"><span><Library size={15} /> {documents.length} papers</span><span><FileText size={15} /> {documents.reduce((sum, doc) => sum + doc.qna_count, 0)} pairs</span></div>
      <div className="storage-pill"><span className="pulse-dot" /> Local workspace</div>
    </header>

    <main className="workspace">
      <aside className="papers-panel">
        <div className="panel-heading"><div><span className="eyebrow">Collection</span><h2>Papers</h2></div>{document && <button className="document-delete" disabled={deletingDocument} title="Delete selected document" onClick={removeDocument}>{deletingDocument ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Delete</button>}</div>
        <div className="paper-list">{documents.map((doc, index) => {
          const reviewed = doc.status_counts.verified; const progress = doc.qna_count ? Math.round(reviewed / doc.qna_count * 100) : 0;
          const reviewComplete = doc.qna_count > 0 && reviewed === doc.qna_count;
          return <button key={doc.doc_id} className={`paper-card ${selectedDoc === doc.doc_id ? "active" : ""}`} onClick={() => setSelectedDoc(doc.doc_id)}>
            <div className="paper-index">{String(index + 1).padStart(2, "0")}</div>
            <div className="paper-copy"><strong>{doc.doc_title}</strong><span>{doc.qna_count} questions · {doc.section_count} sections</span><div className="progress"><i style={{ width: `${progress}%` }} /></div><span className={`document-review-tag ${reviewComplete ? "complete" : "ongoing"}`}>{reviewComplete ? "Review Completed" : "Review Ongoing"}</span></div>
            <ChevronRight size={16} />
          </button>;
        })}</div>
      </aside>

      <section className="questions-panel">
        <div className="panel-heading question-heading"><div><span className="eyebrow">{document?.doc_id || "Document"}</span><h2>Question pairs</h2></div><button className="primary compact" onClick={startNew}><Plus size={16} /> New pair</button></div>
        <div className="question-tools"><label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions…" /></label><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All statuses</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="needs_revision">Needs revision</option></select></div>
        <div className="question-list">{visibleQnas.map((qna, index) => <button key={qna.qid} className={`question-card ${selectedQid === qna.qid ? "active" : ""}`} onClick={() => chooseQna(qna)}>
          <div className="question-number">{String(index + 1).padStart(2, "0")}</div><div className="question-copy"><strong>{qna.question}</strong><div><span className={`status ${qna.status || "unverified"}`}>{statusLabel(qna.status || "unverified")}</span><span>{qna.difficulty}</span><span>{qna.answer_type}</span></div></div>
        </button>)}{!visibleQnas.length && <div className="empty-list"><BookOpen size={26} /><strong>No question pairs here</strong><span>Change the filter or add a new pair.</span></div>}</div>
      </section>

      <section className="editor-panel">
        {draft ? <>
          <div className="editor-header"><div><span className="eyebrow">{isNew ? "New question" : draft.qid}</span><h1>{isNew ? "Compose a Q&A pair" : "Review Q&A"}</h1></div><div className="editor-actions">{!isNew && <button className="icon-button danger" title="Delete pair" onClick={remove}><Trash2 size={17} /></button>}<button className="primary" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save changes</button></div></div>
          {(error || notice) && <div className={`toast ${error ? "error" : "success"}`}>{error ? <CircleAlert size={16} /> : <Check size={16} />}{error || notice}<button onClick={() => { setError(""); setNotice(""); }}><X size={14} /></button></div>}
          <div className="editor-scroll">
            <div className="form-section"><label className="field-label">Question</label><textarea className="question-input" value={draft.question} onChange={(event) => patchDraft({ question: event.target.value })} placeholder="Ask a focused, evidence-grounded question…" /></div>
            <div className="form-grid three"><label><span className="field-label">Review status</span><select value={draft.status || "unverified"} onChange={(event) => patchDraft({ status: event.target.value as ReviewStatus })}><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="needs_revision">Needs revision</option></select></label><label><span className="field-label">Difficulty</span><select value={draft.difficulty} onChange={(event) => patchDraft({ difficulty: event.target.value as QnA["difficulty"] })}><option>easy</option><option>medium</option><option>hard</option></select></label><label><span className="field-label">Answer type</span><select value={draft.answer_type} onChange={(event) => patchDraft({ answer_type: event.target.value as QnA["answer_type"] })}>{answerTypes.map((type) => <option key={type}>{type}</option>)}</select></label></div>
            <div className="answer-columns"><label><span className="field-label">Exact answer</span><textarea value={draft.answer_exact} onChange={(event) => patchDraft({ answer_exact: event.target.value })} placeholder="Concise, precise answer" /></label><label><span className="field-label">LLM Generated Answer</span><textarea value={draft.answer_llm} onChange={(event) => patchDraft({ answer_llm: event.target.value })} placeholder="A fluent, explanatory answer" /></label></div>
            <label><span className="field-label">Tags <small>comma separated</small></span><input value={draft.tags.join(", ")} onChange={(event) => patchDraft({ tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} placeholder="retrieval, benchmark, methods" /></label>
            <div className="source-workbench">
              <div className="source-top"><div className="tabs"><button className={sourceTab === "section" ? "active" : ""} onClick={() => setSourceTab("section")}><FileText size={15} /> Section evidence</button><button className={sourceTab === "pdf" ? "active" : ""} onClick={() => setSourceTab("pdf")}><BookOpen size={15} /> Original PDF</button></div>{sourceTab === "section" ? <select value={selectedSection?.section_id || ""} onChange={(event) => { const section = document?.sections.find((item) => item.section_id === event.target.value); if (section) setSection(section); }}>{document?.sections.map((section) => <option key={section.section_id} value={section.section_id}>{section.section_id} — {section.section_heading}</option>)}</select> : document?.pdf_url && <a className="open-pdf-link" href={document.pdf_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open in new window</a>}</div>
              {sourceTab === "section" ? <div className="evidence-layout"><div className="section-reader"><div className="reader-title"><span>{selectedSection?.section_heading}</span><small>{selectedSection?.text.length.toLocaleString()} characters</small></div><EvidenceText section={selectedSection} draft={draft} /></div><label className="evidence-editor"><span className="field-label">Evidence Sentence</span><textarea value={draft.relevant_sections[0]?.evidence_sentence || ""} onChange={(event) => setEvidence(event.target.value)} placeholder="Paste an exact sentence from the section…" /><small>Offsets: {draft.relevant_sections[0]?.sec_char_start || 0}–{draft.relevant_sections[0]?.sec_char_end || 0}</small></label></div> : document?.pdf_url ? <iframe className="pdf-frame" title="Original paper PDF" src={document.pdf_url} /> : <div className="empty-list"><BookOpen /><strong>PDF not found</strong></div>}
            </div>
          </div>
        </> : <div className="empty-editor"><div><Sparkles size={28} /><h2>Your review desk is clear</h2><p>Select a question pair or create a new one.</p><button className="primary" onClick={startNew}><Plus size={16} /> New pair</button></div></div>}
      </section>
    </main>
  </div>;
}

function EvidenceText({ section, draft }: { section: Section | null; draft: QnA }) {
  if (!section) return null;
  const ref = draft.relevant_sections[0];
  const valid = ref?.section_id === section.section_id && ref.sec_char_end > ref.sec_char_start && section.text.slice(ref.sec_char_start, ref.sec_char_end) === ref.evidence_sentence;
  if (!valid) return <p>{section.text}</p>;
  return <p>{section.text.slice(0, ref.sec_char_start)}<mark>{section.text.slice(ref.sec_char_start, ref.sec_char_end)}</mark>{section.text.slice(ref.sec_char_end)}</p>;
}

export default App;
