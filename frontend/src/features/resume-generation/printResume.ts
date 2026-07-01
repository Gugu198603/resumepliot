const PRINT_STYLES = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #fff;
    color: #111;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }
  .generated-resume-card {
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
    background: #fff;
    font-size: 9pt;
    line-height: 1.28;
  }
  .generated-resume-head,
  .generated-item-title {
    display: flex;
    justify-content: space-between;
    gap: 10pt;
    align-items: flex-start;
  }
  .generated-resume-card h5 {
    margin: 0 0 4pt;
    font-size: 15pt;
    line-height: 1.15;
    color: #111;
  }
  .generated-resume-card p,
  .generated-item ul {
    margin: 0;
    color: #222;
    font-size: 9pt;
    line-height: 1.32;
  }
  .generated-contact,
  .generated-item-title span {
    color: #555;
    font-size: 8pt;
  }
  .generated-section {
    margin-top: 7pt;
    padding-top: 5pt;
    border-top: 0.5pt solid #bbb;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .generated-section h6 {
    margin: 0 0 4pt;
    font-size: 9.5pt;
    color: #111;
    letter-spacing: 0.04em;
  }
  .generated-item {
    display: grid;
    gap: 3pt;
    padding: 3pt 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .generated-item + .generated-item {
    margin-top: 2pt;
    border-top: 0.5pt dashed #bbb;
  }
  .generated-item-title strong {
    color: #111;
    font-size: 9.2pt;
  }
  .generated-summary {
    padding-left: 6pt;
    border-left: 1.5pt solid #aaa;
  }
  .generated-item ul { padding-left: 13pt; }
  .generated-item li + li { margin-top: 1.5pt; }
  .chip {
    display: inline;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: #222;
  }
`;

export function openResumePrintWindow() {
  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  printWindow?.document.write('<!doctype html><title>正在准备 PDF…</title><p style="font-family:sans-serif;padding:32px">正在校验当前简历并准备 PDF…</p>');
  return printWindow;
}

export async function printResumeElement(printWindow: Window, resumeNode: Element) {
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><title>ResumePilot PDF Preview</title><style>${PRINT_STYLES}</style></head><body>${resumeNode.outerHTML}</body></html>`);
  printWindow.document.close();
  try {
    await printWindow.document.fonts?.ready;
  } catch {
    // System font fallbacks keep printing available when font readiness is unsupported.
  }
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}
