export type ReviewStatus = "unverified" | "verified" | "needs_revision";
export type Difficulty = "easy" | "medium" | "hard";

export interface DatasetSummary {
  key: string;
  label: string;
  document_label: string;
  qna_domain: string;
  available: boolean;
}

export interface RelevantSection {
  section_id: string;
  section_heading: string;
  sec_char_start: number;
  sec_char_end: number;
  evidence_sentence: string;
}

export interface QnA {
  qid: string;
  domain: string;
  doc_id: string;
  doc_title: string;
  question: string;
  answer_exact: string;
  answer_llm: string;
  answer_type: string;
  relevant_sections: RelevantSection[];
  source: Record<string, string>;
  created_by: string;
  status: ReviewStatus;
  tags: string[];
  difficulty: Difficulty;
}

export interface Section {
  doc_id: string;
  doc_title: string;
  section_id: string;
  section_heading: string;
  section_order: number;
  text: string;
  source: Record<string, string>;
}

export interface DocumentSummary {
  dataset_key: string;
  doc_id: string;
  doc_title: string;
  section_count: number;
  qna_count: number;
  status_counts: Record<ReviewStatus, number>;
  has_pdf: boolean;
}

export interface DocumentDetail extends DocumentSummary {
  sections: Section[];
  qnas: QnA[];
  pdf_url: string | null;
}
