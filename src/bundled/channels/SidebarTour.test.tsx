// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { SeenStore } from "../../shared/design-system/ui/EducationHint";
import { SeenContext } from "./seen-context";
import { SidebarTour, sidebarTourKey, sidebarTourPages } from "./SidebarTour";

const firstTitle = "Meet the new sidebar";

let marks: Set<string>;
const listeners = new Set<() => void>();
const seen: SeenStore = {
  has: (key) => marks.has(key),
  mark: (key) => {
    marks.add(key);
    for (const listener of listeners) listener();
  },
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

beforeEach(() => {
  marks = new Set();
});
afterEach(cleanup);

function mount(ready = true) {
  const aside = document.createElement("aside");
  const list = document.createElement("div");
  aside.append(list);
  document.body.append(aside);
  const listRef = createRef<HTMLElement | null>() as {
    current: HTMLElement | null;
  };
  listRef.current = list;
  return render(
    <SeenContext.Provider value={seen}>
      <SidebarTour listRef={listRef} ready={ready} />
    </SeenContext.Provider>,
  );
}

test("sidebar tour waits for the layout, then shows its pages in order", async () => {
  const user = userEvent.setup();
  const view = mount(false);
  expect(screen.queryByText(firstTitle)).toBeNull();
  view.unmount();
  mount();
  for (const page of sidebarTourPages.slice(0, -1)) {
    expect(screen.getByText(page.title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
  }
  expect(screen.getByText("Reorder workspaces")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByText("Reorder workspaces")).toBeNull();
  expect(marks.has(sidebarTourKey)).toBe(true);
});

test("sidebar tour stays away once seen on this device", () => {
  marks.add(sidebarTourKey);
  mount();
  expect(screen.queryByText(firstTitle)).toBeNull();
});

test("closing the sidebar tour also counts as seen", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText(firstTitle)).toBeNull();
  expect(marks.has(sidebarTourKey)).toBe(true);
});
