import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Import internal parser directly to avoid pdf-parse's index.js test-file side effect
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

/**
 * Cleans extracted PDF text while preserving paragraph breaks.
 */
export function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Extracts text page-by-page from a PDF buffer.
 * Preserves per-page boundaries for accurate citation metadata.
 */
export async function extractPdfPages(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid or empty PDF buffer');
  }

  const pages = [];

  const options = {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });

      let lastY;
      let pageText = '';
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          pageText += item.str;
        } else {
          pageText += '\n' + item.str;
        }
        lastY = item.transform[5];
      }

      const cleaned = normalizeText(pageText);
      const pageNumber = pages.length + 1;
      pages.push({ pageNumber, text: cleaned });
      return cleaned;
    },
  };

  // Copy into an isolated Uint8Array so pdf.js never reads stale bytes from Node's shared Buffer slab
  const pdfBytes =
    buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
      ? buffer
      : Uint8Array.from(buffer);

  const data = await pdfParse(pdfBytes, options);

  // Fallback if custom pagerender did not capture pages (e.g., unusual PDF structure)
  if (pages.length === 0 && data.text) {
    pages.push({ pageNumber: 1, text: normalizeText(data.text) });
  }

  const nonEmptyPages = pages.filter((p) => p.text.length > 0);
  if (nonEmptyPages.length === 0) {
    throw new Error(
      'No extractable text found in this PDF. Scanned image-only PDFs require OCR before indexing.'
    );
  }

  return {
    pages: nonEmptyPages,
    pageCount: data.numpages || pages.length,
    fullText: nonEmptyPages.map((p) => p.text).join('\n\n'),
    info: data.info || {},
  };
}

/**
 * Finds a clean split boundary near targetEnd (paragraph, sentence, or whitespace).
 */
function findSplitPoint(text, start, targetEnd, minStart) {
  if (targetEnd >= text.length) {
    return text.length;
  }

  const searchFloor = Math.max(minStart, start + Math.floor((targetEnd - start) * 0.55));
  const slice = text.slice(searchFloor, targetEnd);

  const paragraphIdx = slice.lastIndexOf('\n\n');
  if (paragraphIdx !== -1) return searchFloor + paragraphIdx + 2;

  const newlineIdx = slice.lastIndexOf('\n');
  if (newlineIdx !== -1) return searchFloor + newlineIdx + 1;

  const sentenceMatches = [...slice.matchAll(/[.!?]\s+/g)];
  if (sentenceMatches.length > 0) {
    const lastMatch = sentenceMatches[sentenceMatches.length - 1];
    return searchFloor + lastMatch.index + lastMatch[0].length;
  }

  const spaceIdx = slice.lastIndexOf(' ');
  if (spaceIdx !== -1) return searchFloor + spaceIdx + 1;

  return targetEnd;
}

/**
 * Splits extracted PDF pages into overlapping chunks with rich metadata.
 */
export function chunkPages(
  pages,
  { documentId, filename, chunkSize = 1000, chunkOverlap = 200 }
) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  const safeChunkSize = Math.max(100, Number(chunkSize) || 1000);
  const safeOverlap = Math.max(0, Math.min(Number(chunkOverlap) || 0, safeChunkSize - 50));

  const chunks = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const text = normalizeText(page.text);
    if (!text) continue;

    let start = 0;
    while (start < text.length) {
      const targetEnd = start + safeChunkSize;
      const end = findSplitPoint(text, start, targetEnd, start);
      const chunkText = text.slice(start, end).trim();

      if (chunkText.length > 0) {
        chunks.push({
          id: `${documentId}_chunk_${globalChunkIndex}`,
          documentId,
          filename,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex,
          text: chunkText,
          charCount: chunkText.length,
          tokenEstimate: Math.ceil(chunkText.length / 4),
        });
        globalChunkIndex += 1;
      }

      if (end >= text.length) break;

      const nextStart = Math.max(start + 1, end - safeOverlap);
      start = nextStart;
    }
  }

  return chunks;
}
