import { useState } from "react";
import { Notice } from "@/components/ui";
import type { BookModel } from "@/lib/layout/compose";
import type { ProjectSettings } from "@/lib/layout/settings";

/**
 * Booklet or flat, chosen where the printing happens.
 *
 * This is how Publisher does it. The book is written in reading order, and
 * the shuffle that makes a folded stack read 1, 2, 3 is a choice made in the
 * print dialog - "Booklet, side-fold" - rather than a setting buried in the
 * document's layout, where nobody thinks to look on the day they print it.
 *
 * So it starts on booklet, because a church directory is a booklet: printed on
 * both sides, folded down the middle and stapled through the spine. Flat is
 * one tap away for a PDF to email or a corner-stapled handout.
 *
 * Only a sheet with two halves folds. One half, or three, prints flat, and the
 * choice is not offered.
 */
export function usePrintAs(settings: ProjectSettings | null) {
  const [booklet, setBooklet] = useState(true);
  const canFold = settings?.columns === 2;
  return { booklet: booklet && canFold, setBooklet, canFold };
}

export function PrintAs({
  booklet,
  onChange,
}: {
  booklet: boolean;
  onChange: (booklet: boolean) => void;
}) {
  const options = [
    {
      value: true,
      label: "Booklet",
      title: "Pages in folding order: print both sides, fold, staple the spine",
    },
    { value: false, label: "Flat", title: "Pages in reading order, 1, 2, 3, straight through" },
  ];
  return (
    <div className="zoom-levels" role="group" aria-label="Print as">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          className={`zoom-level${option.value === booklet ? " active" : ""}`}
          aria-pressed={option.value === booklet}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** What to set in the print dialog, said above the sheets it applies to. */
export function PrintAsNotice({ booklet }: { booklet: boolean }) {
  return (
    <div className="preview-notice screen-only">
      <Notice>
        {booklet ? (
          <>
            <strong>Printing as a booklet.</strong> The pages are arranged so that the stack, folded
            down the middle and stapled through the spine, reads in order — so page 1 sits beside
            the last page here. In the print dialog: <strong>both sides</strong>, flipping on the{" "}
            <strong>short edge</strong>, at <strong>actual size</strong>, and the printer's own
            booklet setting <strong>off</strong>.
          </>
        ) : (
          <>
            <strong>Printing flat.</strong> Pages run 1, 2, 3 straight through — for a PDF to email
            or a handout stapled in the corner. Choose <strong>Booklet</strong> to fold it.
          </>
        )}
      </Notice>
    </div>
  );
}

/** Paper, not sides: a booklet is printed on both, so it takes half as many. */
export function SheetCount({ book, booklet }: { book: BookModel; booklet: boolean }) {
  const count = booklet ? Math.ceil(book.sheets.length / 2) : book.sheets.length;
  return (
    <span>
      <strong>{count}</strong> {count === 1 ? "sheet" : "sheets"}
      {booklet ? ", both sides" : ""}
    </span>
  );
}
