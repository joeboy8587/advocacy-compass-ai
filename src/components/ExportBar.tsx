import { Download, Printer } from "lucide-react";
import { downloadCsv, printPage } from "@/lib/export";

/**
 * Standard export controls for any data page.
 * CSV = the rows currently on screen. Print = the whole page, save as PDF.
 */
export function ExportBar({
  rows,
  fileName,
  note,
}: {
  rows: Array<Record<string, unknown>> | undefined;
  fileName: string;
  note?: string;
}) {
  const count = rows?.length ?? 0;
  return (
    <div className="no-print flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => rows && downloadCsv(fileName, rows)}
        disabled={!count}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm disabled:opacity-40"
        title="Download the rows shown on this page as a spreadsheet"
      >
        <Download className="size-3" /> CSV ({count.toLocaleString()})
      </button>
      <button
        type="button"
        onClick={printPage}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-primary text-primary rounded-sm"
        title="Print this page — choose 'Save as PDF' to keep a copy for the record"
      >
        <Printer className="size-3" /> Print / PDF
      </button>
      {note && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{note}</span>}
    </div>
  );
}
