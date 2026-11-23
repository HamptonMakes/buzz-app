import { useLayoutEffect, useState, type RefObject } from "react";
import {
  SchematicCard,
  SchematicDropLine,
  SchematicGrip,
  SchematicPointer,
  SchematicRow,
  SchematicScene,
} from "../../shared/design-system/ui/Schematic";
import { Tour, type TourPage } from "../../shared/design-system/ui/Tour";
import { useUnseen } from "../../shared/design-system/ui/EducationHint";
import { sidebarTourKey, stayMessyKey, useSeen } from "./seen-context";

export const sidebarTourPages: readonly TourPage[] = [
  {
    id: "welcome",
    title: "Meet the new sidebar",
    description:
      "Your conversations now live in workspaces you arrange. Here’s a quick look.",
    visual: (
      <SchematicScene still>
        <SchematicCard>
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" tone="accent" />
          <SchematicRow lead="chat" />
        </SchematicCard>
        <SchematicCard>
          <SchematicRow lead="chat" />
          <SchematicRow lead="channel" />
        </SchematicCard>
      </SchematicScene>
    ),
  },
  {
    id: "anything",
    title: "Workspaces hold anything",
    description: "Put chats, channels and DMs together in any workspace.",
    visual: (
      <SchematicScene>
        <SchematicCard>
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" enter={1} />
          <SchematicRow lead="chat" enter={2} />
          <SchematicRow lead="channel" enter={3} />
        </SchematicCard>
      </SchematicScene>
    ),
  },
  {
    id: "resize",
    title: "Resize a workspace",
    description:
      "Drag the handle under a workspace to show more or fewer rows.",
    visual: (
      <SchematicScene>
        <SchematicCard
          visibleRows={2}
          motion="grow"
          grip={
            <SchematicGrip tone="accent">
              <SchematicPointer motion="drag" />
            </SchematicGrip>
          }
        >
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
          <SchematicRow lead="chat" />
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
        </SchematicCard>
      </SchematicScene>
    ),
  },
  {
    id: "show-all",
    title: "See everything at once",
    description: "Double-click the handle under a workspace to show all of it.",
    visual: (
      <SchematicScene>
        <SchematicCard
          visibleRows={2}
          motion="expand"
          grip={
            <SchematicGrip tone="accent">
              <SchematicPointer motion="double-tap" />
            </SchematicGrip>
          }
        >
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
          <SchematicRow lead="chat" />
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
        </SchematicCard>
      </SchematicScene>
    ),
  },
  {
    id: "reorder",
    title: "Reorder workspaces",
    description: "Drag a workspace by its header to move it.",
    visual: (
      <SchematicScene>
        <SchematicCard
          motion="lift"
          travel={2}
          header={<SchematicPointer motion="drag" />}
        >
          <SchematicRow lead="chat" tone="accent" />
        </SchematicCard>
        <SchematicCard motion="yield" travel={1} footer={<SchematicDropLine />}>
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
        </SchematicCard>
      </SchematicScene>
    ),
  },
  {
    id: "tidy",
    title: "Want a tidier sidebar?",
    description:
      "We’ll trim each workspace to its 7 most recent. Drag a handle anytime to show more.",
    visual: (
      <SchematicScene>
        <SchematicCard visibleRows={2} motion="trim">
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
          <SchematicRow lead="chat" />
          <SchematicRow lead="channel" />
          <SchematicRow lead="person" />
        </SchematicCard>
      </SchematicScene>
    ),
  },
];

/** Introduces custom workspaces once per device, beside the sidebar. */
export function SidebarTour({
  listRef,
  ready,
}: {
  listRef: RefObject<HTMLElement | null>;
  /** Wait for the sidebar's layout so the card does not jump as it settles. */
  ready: boolean;
}) {
  const seen = useSeen();
  const unseen = useUnseen(seen, sidebarTourKey);
  const [anchor, setAnchor] = useState<Element | null>(null);
  useLayoutEffect(() => {
    if (!ready || !unseen) return;
    setAnchor(listRef.current?.closest("aside") ?? null);
  }, [listRef, ready, unseen]);
  if (!unseen || !ready || !anchor) return null;
  return (
    <Tour
      open
      label="What’s new in the sidebar"
      pages={sidebarTourPages}
      anchor={anchor}
      side="right"
      align="center"
      finishLabel="Tidy it up"
      declineLabel="Stay messy"
      onDismiss={(reason) => {
        // Only a yes trims; closing early leaves the sidebar as it was.
        if (reason !== "finished") seen?.mark(stayMessyKey);
        seen?.mark(sidebarTourKey);
      }}
    />
  );
}
