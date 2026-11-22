import { useLayoutEffect, useRef, useState } from "react";

// A dashboard shaped like a plugin's Plan tile. Docked, it grows up to the
// height the host gives it and then scrolls its own region without a
// scrollbar; its details card escapes that region to the left, over the
// history. In a narrow reader it overlays the transcript out of flow, taking
// no width, and scrolls its own content. `short` fits in a window, `tall` is
// taller than one.
const WIDTH = 300;
const MIN_CHAT = 600;
const STEP =
  "Check the rollout dashboard, confirm error rates stay flat, then post the summary.";

export type AsideSize = "short" | "tall";

export function AsideWidget({ size }: { size: AsideSize }) {
  const root = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  // The offset parent spans the reader's width: it picks docked or overlay.
  useLayoutEffect(() => {
    const row = root.current?.offsetParent ?? root.current?.parentElement;
    if (!(row instanceof HTMLElement)) return;
    const measure = () => setWide(row.clientWidth - WIDTH >= MIN_CHAT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const steps = size === "tall" ? 28 : 5;
  const tile = (
    <section
      aria-label="Fixture dashboard"
      style={{
        width: WIDTH,
        boxSizing: "border-box",
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-panel, Canvas)",
        boxShadow: "0 0 0 1px var(--border-standard, #8884)",
      }}
    >
      <h3 style={{ margin: "0 0 8px" }}>
        Plan · {steps} steps{" "}
        <button
          type="button"
          onPointerEnter={() => setDetails(true)}
          onPointerLeave={() => setDetails(false)}
          onFocus={() => setDetails(true)}
          onBlur={() => setDetails(false)}
        >
          Details
        </button>
      </h3>
      <ol style={{ margin: 0, paddingInlineStart: 20, lineHeight: "20px" }}>
        {Array.from({ length: steps }, (_, index) => index + 1).map((step) => (
          <li key={step} style={{ marginBottom: 12 }}>
            <strong>Step {step}.</strong> {STEP}
          </li>
        ))}
      </ol>
      <p style={{ margin: 0, fontWeight: 600 }}>End of plan</p>
    </section>
  );
  return (
    <div
      ref={root}
      data-fixture-aside={wide ? "docked" : "overlay"}
      style={
        wide
          ? {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
              maxHeight: "var(--workspace-aside-max-height)",
              padding: "12px 0 12px 12px",
            }
          : open
            ? {
                position: "absolute",
                top: 12,
                bottom: 12,
                right: 0,
                overflowY: "auto",
              }
            : { position: "absolute", top: 12, right: 0 }
      }
    >
      {wide ? (
        <div
          data-fixture-aside-scroll=""
          style={{ minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}
        >
          {tile}
        </div>
      ) : open ? (
        <div style={{ boxShadow: "0 8px 24px #0004", borderRadius: 12 }}>
          <button type="button" onClick={() => setOpen(false)}>
            Hide dashboard
          </button>
          {tile}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Show dashboard
        </button>
      )}
      {wide && details && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: 12,
            right: "calc(100% + 8px)",
            width: 240,
            padding: 12,
            borderRadius: 12,
            background: "var(--surface-panel, Canvas)",
            boxShadow: "0 8px 24px #0004",
          }}
        >
          Step details escape the Plan, over the history.
        </div>
      )}
    </div>
  );
}
