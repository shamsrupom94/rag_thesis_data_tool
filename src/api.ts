import type { DatasetSummary, DocumentDetail, DocumentSummary, QnA } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  datasets: () => request<DatasetSummary[]>("/api/datasets"),
  documents: (datasetKey: string) => request<DocumentSummary[]>(`/api/datasets/${encodeURIComponent(datasetKey)}/documents`),
  document: (datasetKey: string, docId: string) =>
    request<DocumentDetail>(`/api/datasets/${encodeURIComponent(datasetKey)}/documents/${docId}`),
  deleteDocument: (datasetKey: string, docId: string) =>
    request<{ doc_id: string; deleted_files: string[]; removed_sectionized_rows: number }>(
      `/api/datasets/${encodeURIComponent(datasetKey)}/documents/${docId}`,
      { method: "DELETE" },
    ),
  create: (datasetKey: string, docId: string, qna: Omit<QnA, "qid" | "domain" | "doc_id" | "doc_title" | "source" | "created_by">) =>
    request<QnA>(`/api/datasets/${encodeURIComponent(datasetKey)}/documents/${docId}/qnas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(qna),
    }),
  update: (datasetKey: string, docId: string, qid: string, qna: QnA) =>
    request<QnA>(`/api/datasets/${encodeURIComponent(datasetKey)}/documents/${docId}/qnas/${encodeURIComponent(qid)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(qna),
    }),
  remove: (datasetKey: string, docId: string, qid: string) =>
    request<void>(`/api/datasets/${encodeURIComponent(datasetKey)}/documents/${docId}/qnas/${encodeURIComponent(qid)}`, { method: "DELETE" }),
};
