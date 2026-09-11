import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number; // 0-based
  scale: number;
  onClick?: (xPoints: number, yPoints: number) => void;
  onMeasured?: (pageIndex: number, widthPoints: number, heightPoints: number) => void;
  children?: React.ReactNode; // absolutely-positioned overlay content, in pixel space
}

export default function PdfPageCanvas({ doc, pageIndex, scale, onClick, onMeasured, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageHeightPoints, setPageHeightPoints] = useState(0);
  const [cssSize, setCssSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageIndex + 1).then(async (page) => {
      if (cancelled) return;
      const unscaledViewport = page.getViewport({ scale: 1 });
      setPageHeightPoints(unscaledViewport.height);
      onMeasured?.(pageIndex, unscaledViewport.width, unscaledViewport.height);

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCssSize({ width: viewport.width, height: viewport.height });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, scale]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const xPoints = pxX / scale;
    const yPoints = pageHeightPoints - pxY / scale; // flip: canvas y-down -> PDF y-up
    onClick(xPoints, yPoints);
  }

  return (
    <div
      className={`pdf-page-wrap${onClick ? " placing" : ""}`}
      style={{ width: cssSize.width || undefined, height: cssSize.height || undefined }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} />
      {children}
    </div>
  );
}
