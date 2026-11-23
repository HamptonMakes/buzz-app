import {
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { PreviewCard } from "./PreviewCard";

/** What EducationHint needs from the host's Seen service. */
export type SeenStore = {
  has(key: string): boolean | undefined;
  mark(key: string): void;
  subscribe(listener: () => void): () => void;
};

const never = () => () => {};

/** True only once Seen has answered that this moment has not happened. */
export function useUnseen(seen: SeenStore | undefined, key: string) {
  return (
    useSyncExternalStore(seen?.subscribe ?? never, () => seen?.has(key)) ===
    false
  );
}

/**
 * A one-time tip about a feature, opened by hovering or focusing the control it
 * explains. It stays available until the person chooses "Dismiss", which Seen
 * remembers; using the feature does not dismiss it. Without Seen, or once
 * seen, only the control renders.
 */
export function EducationHint({
  seen,
  seenKey,
  children,
  content,
  side = "bottom",
}: {
  seen: SeenStore | undefined;
  /** `<plugin-id>/<name>`; a new key shows an updated tip again. */
  seenKey: string;
  /** The one control the tip explains. */
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const unseen = useUnseen(seen, seenKey);
  const action = useRef<HTMLButtonElement>(null);
  if (!unseen) return children;
  return (
    <PreviewCard
      trigger={children}
      side={side}
      actionRef={action}
      tone="inverse"
      aria-label="Tip"
    >
      <span>
        {content}{" "}
        <Button
          ref={action}
          variant="link"
          size="text"
          onClick={() => seen?.mark(seenKey)}
        >
          Dismiss
        </Button>
      </span>
    </PreviewCard>
  );
}
