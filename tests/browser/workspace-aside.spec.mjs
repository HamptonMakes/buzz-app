// A channel workspace's aside floats at the reader's end edge, beside the
// history's scrollbar, and the history leaves a docked aside its width.
import { test, expect } from "./fixture.mjs";
import { open, settle } from "./timeline.mjs";

test.use({
  pluginFixtures: true,
  historyCounts: { alpha: 640, beta: 3 },
  viewport: { width: 1280, height: 800 },
});

const history = (page) =>
  page.getByRole("region", { name: "Channel message history" });
const aside = (page) => page.locator("[data-fixture-aside]");

async function openReader(page, params) {
  await expect
    .poll(() =>
      page.evaluate(async (params) => {
        const result = await window.fixtureNavigation
          ?.open({
            version: 1,
            kind: "page",
            pluginId: "fixture.session",
            pageId: "reader",
            route: { version: 1, params: { channelId: "alpha", ...params } },
          })
          .catch(() => undefined);
        return result?.status;
      }, params),
    )
    .toBe("opened");
}

async function openAside(page, params = {}) {
  await openReader(page, { aside: "tall", ...params });
  await expect(aside(page)).toBeVisible();
}

// The history, its list, the aside and the composer, in viewport pixels.
const layout = (page) =>
  history(page).evaluate((element) => {
    const box = (node) => {
      const { top, right, bottom, left, width, height } =
        node.getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    const widget = document.querySelector("[data-fixture-aside]");
    const region = widget.querySelector("[data-fixture-aside-scroll]");
    return {
      history: box(element),
      // The scrollport's end edge, left of a classic scrollbar.
      scrollport: element.getBoundingClientRect().left + element.clientWidth,
      list: box(element.querySelector("ol")),
      aside: box(widget),
      frame: box(element.parentElement),
      composer: box(element.parentElement.querySelector("form")),
      // The offset parent spans the reader, so a page can choose its layout.
      parent: widget.offsetParent.clientWidth,
      region: region && {
        scrollHeight: region.scrollHeight,
        clientHeight: region.clientHeight,
        scrollTop: region.scrollTop,
      },
    };
  });

// The offset past the latest message, less any trailing card's growth.
const past = (region) =>
  region.evaluate((element) => {
    const content = element.querySelector(
      '[aria-label="Fixture card"]',
    )?.parentElement;
    const card = -Number.parseFloat(content?.style.bottom || "0");
    return (
      element.scrollTop -
      Math.max(0, element.scrollHeight - element.clientHeight - card)
    );
  });

test("a docked aside floats beside the history and composer, which leave it its width", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const at = await layout(page);
  expect(at.aside.width).toBeGreaterThan(300);
  expect(at.list.right).toBeLessThanOrEqual(at.aside.left + 1);
  expect(at.composer.right).toBeLessThanOrEqual(at.aside.left + 1);
  // The composer stays centered under the history's narrowed column.
  expect(
    Math.abs(
      at.composer.left +
        at.composer.width / 2 -
        (at.list.left + at.list.width / 2),
    ),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(at.aside.right - at.scrollport)).toBeLessThanOrEqual(1);
  expect(at.parent).toBeGreaterThanOrEqual(at.list.width + at.aside.width - 1);
  // A tall aside fills the view from the history's top to the frame's bottom,
  // beside the composer, and scrolls its own region.
  expect(Math.abs(at.aside.top - at.history.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(at.aside.bottom - at.frame.bottom)).toBeLessThanOrEqual(1);
  expect(at.aside.bottom).toBeGreaterThan(at.composer.top);
  expect(at.region.scrollHeight).toBeGreaterThan(at.region.clientHeight);
  // The host's container clips nothing and traps no fixed positioning.
  expect(
    await aside(page).evaluate((widget) => {
      const style = getComputedStyle(widget.parentElement);
      return [
        style.overflowX,
        style.overflowY,
        style.contain,
        style.clipPath,
        style.transform,
        style.filter,
        style.willChange,
      ];
    }),
  ).toEqual(["visible", "visible", "none", "none", "none", "none", "auto"]);

  // Wheeling over the aside scrolls only its region.
  const offset = await region.evaluate((element) => element.scrollTop);
  await aside(page).hover();
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => (await layout(page)).region.scrollTop)
    .toBeGreaterThan(100);
  expect(await region.evaluate((element) => element.scrollTop)).toBe(offset);
});

test("a short aside keeps its height", async ({ page, app }) => {
  await open(page, app);
  await openAside(page, { aside: "short" });
  await settle(page, history(page));
  const at = await layout(page);
  expect(at.region.scrollHeight).toBeLessThanOrEqual(at.region.clientHeight);
  expect(at.aside.bottom).toBeLessThan(at.frame.bottom - 50);
  expect(Math.abs(at.aside.top - at.history.top)).toBeLessThanOrEqual(1);
});

test("an aside's popover escapes to the left over the history", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  await settle(page, history(page));
  await aside(page).getByRole("button", { name: "Details" }).hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const shown = await tooltip.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const widget = node.closest("[data-fixture-aside]");
    const x = box.left + 8;
    const y = box.top + box.height / 2;
    return {
      right: box.right,
      asideLeft: widget.getBoundingClientRect().left,
      // It sits above the history's rows under it.
      onTop: node.contains(document.elementFromPoint(x, y)),
    };
  });
  expect(shown.right).toBeLessThan(shown.asideLeft);
  expect(shown.onTop).toBe(true);
});

test("the aside stays put while the history scrolls fast past rows that load", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  await region.evaluate((element) => {
    const widget = document.querySelector("[data-fixture-aside]");
    window.asideSamples = [];
    const frame = () => {
      window.asideSamples.push({
        aside: widget.getBoundingClientRect().top,
        offset: element.scrollTop,
        height: element.scrollHeight,
      });
      window.asideSampling = requestAnimationFrame(frame);
    };
    frame();
  });
  // Fast up through rows never measured, with a short reversal every few
  // steps, releasing older pages as they are requested.
  await region.hover();
  const wheel = async (delta, steps) => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, delta);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      while (app.pending.length) app.pending.shift().release();
    }
  };
  for (let i = 0; i < 10; i++) {
    await wheel(-400, 4);
    await wheel(400, 2);
  }
  const samples = await page.evaluate(() => {
    cancelAnimationFrame(window.asideSampling);
    return window.asideSamples;
  });
  expect(
    samples.some(
      (sample, i) =>
        sample.height > (samples[i - 1]?.height ?? Infinity) + 1000,
    ),
    "an older page landed while sampling",
  ).toBe(true);
  expect(
    Math.max(...samples.map((sample) => sample.offset)) -
      Math.min(...samples.map((sample) => sample.offset)),
  ).toBeGreaterThan(2000);
  for (let i = 1; i < samples.length; i++)
    expect(samples[i].aside, `frame ${i}: the aside moved`).toBe(
      samples[i - 1].aside,
    );
});

test("adding and removing the aside keeps the reader at the latest message", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openReader(page, {});
  const region = history(page);
  await settle(page, region);
  expect(Math.abs(await past(region))).toBeLessThanOrEqual(1);
  // The same scroller stays mounted throughout.
  await region.evaluate((element) => {
    window.asideScroller = element;
  });
  const same = () =>
    region.evaluate((element) => element === window.asideScroller);
  // As a plugin does when its content arrives, without a navigation.
  await page.evaluate(() => window.fixtureAside("tall"));
  await expect(aside(page)).toBeVisible();
  await settle(page, region);
  expect(Math.abs(await past(region))).toBeLessThanOrEqual(1);
  expect(await same()).toBe(true);
  await page.evaluate(() => window.fixtureAside(null));
  await expect(aside(page)).toHaveCount(0);
  await settle(page, region);
  expect(Math.abs(await past(region))).toBeLessThanOrEqual(1);
  expect(await same()).toBe(true);
  expect(
    await region.evaluate((element) => [
      element.hasAttribute("data-aside-docked"),
      element.parentElement.style.getPropertyValue("--timeline-aside-width"),
    ]),
  ).toEqual([false, ""]);
});

test("a narrow reader overlays the aside, taking no width, and resizing docks it again", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const docked = (await layout(page)).list.width;
  await page.setViewportSize({ width: 900, height: 800 });
  const overlay = page.locator('[data-fixture-aside="overlay"]');
  await expect(overlay).toBeVisible();
  await expect
    .poll(async () => {
      const at = await layout(page);
      return at.history.right - at.list.right;
    })
    .toBeLessThan(40);
  // Opened, the overlay spans the history, not the composer, and scrolls its
  // own content, not the history.
  await overlay.getByRole("button", { name: "Show dashboard" }).click();
  await expect(
    page.getByRole("region", { name: "Fixture dashboard" }),
  ).toBeVisible();
  await settle(page, region);
  const at = await layout(page);
  expect(at.aside.bottom).toBeLessThanOrEqual(at.history.bottom);
  // Opened, the overlay still takes no width from the history.
  expect(at.history.right - at.list.right).toBeLessThan(40);
  expect(
    await region.evaluate((element) =>
      element.hasAttribute("data-aside-docked"),
    ),
  ).toBe(false);
  const offset = await region.evaluate((element) => element.scrollTop);
  const scrolled = await overlay.evaluate((element) => {
    element.scrollTop = 200;
    return {
      own: element.scrollHeight > element.clientHeight,
      top: element.scrollTop,
    };
  });
  expect(scrolled).toEqual({ own: true, top: 200 });
  await settle(page, region);
  expect(await region.evaluate((element) => element.scrollTop)).toBe(offset);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('[data-fixture-aside="docked"]')).toBeVisible();
  await expect
    .poll(async () => (await layout(page)).list.width)
    .toBeCloseTo(docked, 0);
  await settle(page, region);
  expect(Math.abs(await past(region))).toBeLessThanOrEqual(1);
});

test("a live resize beside an aside keeps the reader at rest", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page, { trailing: "long" });
  const region = history(page);
  await settle(page, region);
  expect(Math.abs(await past(region))).toBeLessThanOrEqual(1);
  // A window drag resizes faster than the timeline renders, undocking and
  // docking the aside and rewrapping the card as it goes.
  for (const [from, to] of [
    [1280, 860],
    [860, 1320],
  ]) {
    for (let step = 1; step <= 30; step++)
      await page.setViewportSize({
        width: Math.round(from + ((to - from) * step) / 30),
        height: 800,
      });
    await settle(page, region);
    expect(
      Math.abs(await past(region)),
      `at rest after resizing to ${to}`,
    ).toBeLessThanOrEqual(1);
  }
});

test.describe("beside a narrow dock", () => {
  test.use({
    readState: true,
    threadUnread: true,
    historyCounts: { alpha: 40, beta: 3 },
    viewport: { width: 600, height: 800 },
  });

  test("a narrow dock covers the aside", async ({ page, app }) => {
    await open(page, app);
    await openAside(page);
    const region = history(page);
    await settle(page, region);
    const button = aside(page).getByRole("button", { name: "Show dashboard" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const root = app.histories
      .get("primary/alpha")
      .find((row) => row.content === "Thread root 1");
    const row = region.locator(`[data-message-id="${root.id}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row.getByRole("button", { name: /^View thread:/ }).click();
    const dock = page.locator("[data-panel-dock]");
    await expect(dock).toBeVisible();
    await dock.evaluate((element) =>
      Promise.allSettled(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
    // The dock paints over the aside's control. Hit testing skips the covered,
    // inert reader, so the probe lifts that while it reads the paint order.
    expect(
      await page.evaluate(({ x, y }) => {
        const covered = document
          .querySelector("[data-fixture-aside]")
          .closest("[inert]");
        covered?.removeAttribute("inert");
        const hit = document.elementFromPoint(x, y);
        covered?.setAttribute("inert", "");
        return {
          covered: !!covered,
          docked: !!hit?.closest("[data-panel-dock]"),
        };
      }, center),
    ).toEqual({ covered: true, docked: true });
  });
});

test.describe("with a person typing", () => {
  test.use({ productionBroker: true });

  test("the typing label keeps the composer's column beside a docked aside", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openAside(page);
    await settle(page, history(page));
    app.activity({ channel: "alpha" });
    const typing = page
      .locator('[aria-hidden="true"]')
      .filter({ hasText: /is typing$/ });
    await expect(typing).toBeVisible();
    // The label's lane spans the composer's column.
    const at = await layout(page);
    const lane = await page
      .locator('[data-audience="humans"]')
      .filter({ hasText: /is typing$/ })
      .boundingBox();
    expect(Math.abs(lane.x - at.composer.left)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(lane.x + lane.width - at.composer.right),
    ).toBeLessThanOrEqual(1);
  });
});
