import type { DocumentDetail, DocumentSummary, QnA } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  documents: () => request<DocumentSummary[]>("/api/documents"),
  document: (docId: string) => request<DocumentDetail>(`/api/documents/${docId}`),
  deleteDocument: (docId: string) =>
    request<{ doc_id: string; deleted_files: string[]; removed_sectionized_rows: number }>(`/api/documents/${docId}`, { method: "DELETE" }),
  create: (docId: string, qna: Omit<QnA, "qid" | "domain" | "doc_id" | "doc_title" | "source" | "created_by">) =>
    request<QnA>(`/api/documents/${docId}/qnas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qna) }),
  update: (docId: string, qid: string, qna: QnA) =>
    request<QnA>(`/api/documents/${docId}/qnas/${encodeURIComponent(qid)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qna) }),
  remove: (docId: string, qid: string) => request<void>(`/api/documents/${docId}/qnas/${encodeURIComponent(qid)}`, { method: "DELETE" }),
};
