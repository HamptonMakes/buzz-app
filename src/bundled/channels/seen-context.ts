import { createContext, useContext } from "react";
import type { SeenStore } from "../../shared/design-system/ui/EducationHint";

/** The host's Seen service, when it has one, for the sidebar's one-time tips. */
export const SeenContext = createContext<SeenStore | undefined>(undefined);

export const useSeen = () => useContext(SeenContext);
