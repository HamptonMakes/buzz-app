// A channel workspace's aside scrolls with the transcript in one scroller.
import { test, expect } from "./fixture.mjs";
import { open, settle } from "./timeline.mjs";

test.use({
  pluginFixtures: true,
  historyCounts: { alpha: 640, beta: 3 },
  viewport: { width: 1280, height: 800 },
});

const history = (page) =>
  page.getByRole("region", { name: "Channel message history" });
const dashboard = (page) =>
  history(page).getByRole("region", { name: "Fixture dashboard" });

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
  await expect(
    history(page).locator(
      '[data-fixture-aside="docked"], [data-fixture-aside="overlay"]',
    ),
  ).toBeVisible();
}

// The widget's top and bottom in the history, the offset past the latest
// message (the transcript's end less the trailing card's growth), and the top
// of the last row on screen.
const place = (region) =>
  region.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const widget = element.querySelector('[aria-label="Fixture dashboard"]');
    const content = element.querySelector(
      '[aria-label="Fixture card"]',
    )?.parentElement;
    const card = -Number.parseFloat(content?.style.bottom || "0");
    const transcript = element.firstElementChild;
    const latest = Math.max(
      0,
      transcript.offsetHeight - element.clientHeight - card,
    );
    const rows = [...element.querySelectorAll("[data-message-id]")].filter(
      (row) => row.getBoundingClientRect().top < bounds.bottom,
    );
    return {
      top: widget.getBoundingClientRect().top - bounds.top,
      bottom: widget.getBoundingClientRect().bottom - bounds.top,
      view: element.clientHeight,
      past: element.scrollTop - latest,
      row: rows.at(-1)?.getBoundingClientRect().top - bounds.top,
    };
  });

// Installs `window.asideSample()`: the sticky frame's top and its lowest
// place, the offset, the scroll height, the offset past the latest message and
// the rows on screen.
const installSampler = (region) =>
  region.evaluate((element) => {
    let frame = element.querySelector('[aria-label="Fixture dashboard"]');
    while (getComputedStyle(frame).position !== "sticky")
      frame = frame.parentElement;
    window.asideSample = () => {
      const bounds = element.getBoundingClientRect();
      const rows = {};
      for (const row of element.querySelectorAll("[data-message-id]")) {
        const box = row.getBoundingClientRect();
        if (box.bottom > bounds.top && box.top < bounds.bottom)
          rows[row.dataset.messageId] = box.top;
      }
      return {
        top: frame.getBoundingClientRect().top - bounds.top,
        band: element.clientHeight - frame.offsetHeight,
        offset: element.scrollTop,
        height: element.scrollHeight,
        past:
          element.scrollTop -
          Math.max(
            0,
            element.firstElementChild.offsetHeight - element.clientHeight,
          ),
        rows,
      };
    };
  });

// Each frame the widget moves with the rows on screen, or past the latest
// message with the offset, held between its stuck-at-bottom and stuck-at-top
// places. Rows landing above may instead leave it where it was from the end.
function expectFollows(samples) {
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]];
    const clamp = (top) => Math.min(0, Math.max(b.band, top));
    const id = Object.keys(b.rows).find((row) => row in a.rows);
    const rows = id ? b.rows[id] - a.rows[id] : a.offset - b.offset;
    const withRows = clamp(
      a.top + rows - (Math.max(0, b.past) - Math.max(0, a.past)),
    );
    const fromEnd = clamp(
      a.top - (b.offset - a.offset - (b.height - a.height)),
    );
    expect(
      Math.min(
        Math.abs(b.top - withRows),
        b.height === a.height ? Infinity : Math.abs(b.top - fromEnd),
      ),
      `frame ${i}: widget at ${Math.round(b.top)}, expected ${Math.round(withRows)}`,
    ).toBeLessThanOrEqual(1.5);
  }
}

test("a fast reversal while an older page lands moves the widget with the scroll", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const rest = await place(region);
  expect(Math.abs(rest.past)).toBeLessThanOrEqual(1);

  // Scroll a little past the latest message: only the widget moves.
  await region.hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 60);
  await expect
    .poll(async () => (await place(region)).past)
    .toBeGreaterThan(200);
  const past = await place(region);
  expect(Math.abs(past.top - (rest.top - past.past))).toBeLessThanOrEqual(2);

  // A fresh channel's first older page is already requested. Hold it, then
  // scroll back quickly as it lands: one step per frame, sampled each frame
  // with the rows on screen.
  await expect.poll(() => app.pending.length).toBe(1);
  await installSampler(region);
  await region.evaluate((element) => {
    const height = element.scrollHeight;
    const samples = [];
    window.reversal = new Promise((resolve) => {
      const step = () => {
        if (element.scrollHeight !== height) {
          samples.push(window.asideSample());
          if (samples.length > 12) return resolve(samples);
          element.scrollTop -= 150;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  app.pending.shift().release();
  const samples = await page.evaluate(() => window.reversal);
  expect(Math.min(...samples.map((sample) => sample.past))).toBeLessThan(0);
  expectFollows(samples);
});

test("fast reversals into unmeasured rows move the widget with the scroll", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  await installSampler(region);
  await region.evaluate(() => {
    window.asideSamples = [];
    const frame = () => {
      window.asideSamples.push(window.asideSample());
      window.asideSampling = requestAnimationFrame(frame);
    };
    frame();
  });
  // Past the latest message, then fast up through rows never measured, with a
  // short fast reversal every few steps: the widget is mid-travel as older
  // pages land and rows measure.
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
  await wheel(400, 4);
  for (let i = 0; i < 10; i++) {
    await wheel(-400, 4);
    await wheel(400, 2);
  }
  const samples = await page.evaluate(() => {
    cancelAnimationFrame(window.asideSampling);
    return window.asideSamples;
  });
  expect(Math.max(...samples.map((sample) => sample.past))).toBeGreaterThan(0);
  expect(
    samples.some(
      (sample, i) =>
        sample.height > (samples[i - 1]?.height ?? Infinity) + 1000,
    ),
    "an older page landed while sampling",
  ).toBe(true);
  expectFollows(samples);
});

test("layout keeps a reader's small scroll above the latest message", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const rest = await place(region);
  expect(Math.abs(rest.past)).toBeLessThanOrEqual(1);

  // Within the follow threshold the reader still follows the latest message.
  await region.hover();
  await page.mouse.wheel(0, -40);
  await expect
    .poll(async () => (await place(region)).past)
    .toBeLessThanOrEqual(-39);
  const height = await region.evaluate((element) => element.scrollHeight);
  // The widget grows, which lengthens its range past the latest message and
  // realigns a follower. Wait for that range, then for the realignment.
  await region
    .getByRole("region", { name: "Fixture dashboard" })
    .evaluate((widget) => {
      widget.style.paddingBottom = "36px";
    });
  await expect
    .poll(() => region.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(height);
  await settle(page, region);
  const after = await place(region);
  expect(after.past, "the reader's scroll is kept").toBeLessThanOrEqual(-39);
  expect(
    Math.abs(after.top - rest.top),
    "the widget stays put",
  ).toBeLessThanOrEqual(1);
});

test("a docked aside sits beside the transcript, which leaves it its width", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const layout = await region.evaluate((element) => {
    const box = (node) => node.getBoundingClientRect();
    const aside = element.querySelector("[data-fixture-aside]");
    return {
      history: box(element),
      list: box(element.querySelector("ol")),
      aside: box(aside),
      // The offset parent spans the reader, so a page can choose its layout.
      parent: aside.offsetParent.clientWidth,
    };
  });
  expect(layout.aside.width).toBeGreaterThan(300);
  expect(layout.list.right).toBeLessThanOrEqual(layout.aside.left + 1);
  expect(layout.aside.right).toBeLessThanOrEqual(layout.history.right);
  expect(layout.parent).toBeGreaterThanOrEqual(
    layout.list.width + layout.aside.width - 1,
  );
  // Scrolling up into history keeps the widget's top in view; turning back
  // moves it with the transcript.
  const rest = await place(region);
  await region.hover();
  // WebKit can coalesce wheel events sent faster than it renders, so wheel
  // until the reader is well into history.
  for (let i = 0; i < 60 && (await place(region)).past > -2000; i++)
    await page.mouse.wheel(0, -120);
  expect((await place(region)).past).toBeLessThan(-2000);
  await settle(page, region);
  const up = await place(region);
  expect(Math.abs(up.top - rest.top)).toBeLessThanOrEqual(1.5);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => (await place(region)).past - up.past)
    .toBeGreaterThan(100);
  await settle(page, region);
  const back = await place(region);
  expect(
    Math.abs(back.top - (up.top - (back.past - up.past))),
  ).toBeLessThanOrEqual(1.5);
});

test("past the latest message only the widget moves, until its end shows", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const rest = await place(region);
  expect(Math.abs(rest.past)).toBeLessThanOrEqual(1);
  expect(rest.bottom).toBeGreaterThan(rest.view);
  await region.hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 60);
  await expect
    .poll(async () => (await place(region)).past - rest.past)
    .toBeGreaterThan(100);
  await settle(page, region);
  const past = await place(region);
  expect(past.row, "the transcript stays put").toBeCloseTo(rest.row, 0);
  expect(
    Math.abs(past.top - (rest.top - (past.past - rest.past))),
  ).toBeLessThanOrEqual(1.5);
  // The range ends where the widget's end shows.
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => {
      const at = await place(region);
      return Math.round(at.bottom - at.view);
    })
    .toBeLessThanOrEqual(1);
  const end = await place(region);
  expect(end.bottom).toBeGreaterThan(end.view - 40);
  expect(end.row).toBeCloseTo(rest.row, 0);
  // An aside that grows there lengthens the range to its new end.
  await dashboard(page).evaluate((widget) => {
    widget.style.paddingBottom = "200px";
  });
  await settle(page, region);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => {
      const at = await place(region);
      return Math.round(at.bottom - at.view);
    })
    .toBeLessThanOrEqual(1);
  expect((await place(region)).bottom).toBeGreaterThan(end.view - 40);
});

test("a short aside keeps its height and adds no range past the latest message", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page, { aside: "short" });
  const region = history(page);
  await settle(page, region);
  const rest = await place(region);
  expect(Math.abs(rest.past)).toBeLessThanOrEqual(1);
  // The frame spans the viewport but leaves the aside its own height.
  const heights = await region
    .locator('[data-fixture-aside="docked"]')
    .evaluate((root) => [
      root.offsetHeight,
      root.firstElementChild.offsetHeight + 24,
      root.parentElement.offsetHeight,
    ]);
  expect(heights[0], "the frame does not stretch the aside").toBe(heights[1]);
  expect(heights[2]).toBeGreaterThan(heights[0]);
  expect(
    await region.evaluate((element) =>
      element.style.getPropertyValue("--timeline-aside-extra"),
    ),
  ).toBe("0px");
  // Scrolling down at the latest message moves nothing.
  await region.hover();
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await settle(page, region);
  const after = await place(region);
  expect(Math.abs(after.past)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - rest.top)).toBeLessThanOrEqual(1);
});

test("adding and removing the aside keeps the reader at the latest message", async ({
  page,
  app,
}) => {
  const atLatest = (region) =>
    region.evaluate(
      (element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
    );
  await open(page, app);
  await openReader(page, {});
  const region = history(page);
  await settle(page, region);
  expect(await atLatest(region)).toBeLessThanOrEqual(1);
  await openAside(page);
  await settle(page, region);
  expect(Math.abs((await place(region)).past)).toBeLessThanOrEqual(1);
  await openReader(page, {});
  await expect(region.locator("[data-fixture-aside]")).toHaveCount(0);
  await settle(page, region);
  expect(await atLatest(region)).toBeLessThanOrEqual(1);
  expect(
    await region.evaluate((element) => [
      element.hasAttribute("data-aside"),
      element.style.getPropertyValue("--timeline-aside-width"),
      element.style.getPropertyValue("--timeline-aside-extra"),
    ]),
  ).toEqual([false, "", ""]);
});

test("a narrow reader overlays the aside, taking no width, and resizing docks it again", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const docked = await region.evaluate(
    (element) => element.querySelector("ol").getBoundingClientRect().width,
  );
  await page.setViewportSize({ width: 900, height: 800 });
  const overlay = region.locator('[data-fixture-aside="overlay"]');
  await expect(overlay).toBeVisible();
  await expect
    .poll(() =>
      region.evaluate(
        (element) =>
          element.getBoundingClientRect().right -
          element.querySelector("ol").getBoundingClientRect().right,
      ),
    )
    .toBeLessThan(40);
  // Opened, the overlay scrolls its own content, not the history.
  await overlay.getByRole("button", { name: "Show dashboard" }).click();
  await expect(dashboard(page)).toBeVisible();
  // The resize's own layout corrections finish before the baseline.
  await settle(page, region);
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
  await expect(region.locator('[data-fixture-aside="docked"]')).toBeVisible();
  await expect
    .poll(() =>
      region.evaluate(
        (element) => element.querySelector("ol").getBoundingClientRect().width,
      ),
    )
    .toBeCloseTo(docked, 0);
  await settle(page, region);
  expect(Math.abs((await place(region)).past)).toBeLessThanOrEqual(1);
});

test("Full brief and Hide move between the card's top and the latest message beside an aside", async ({
  page,
  app,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, app);
  await openAside(page, { trailing: "long" });
  const region = history(page);
  const toggle = region
    .getByRole("article", { name: "Fixture card" })
    .getByRole("button", { name: /brief/ });
  await expect(toggle).toHaveText("Full brief");
  await settle(page, region);
  expect(Math.abs((await place(region)).past)).toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(toggle).toHaveText("Hide brief");
  // The card's content shows below a gap of history.
  const card = await region.evaluate(
    (element) =>
      element
        .querySelector('[aria-label="Fixture card"]')
        .parentElement.getBoundingClientRect().top -
      element.getBoundingClientRect().top,
  );
  expect(card).toBeGreaterThan(0);
  expect(card).toBeLessThanOrEqual(101);
  const expanded = await place(region);
  expect(expanded.bottom, "the widget stays on screen").toBeGreaterThan(0);
  // The aside's range follows the card's: scrolling on shows the aside's end.
  await region.hover();
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => {
      const at = await place(region);
      return Math.round(at.bottom - at.view);
    })
    .toBeLessThanOrEqual(1);
  expect((await place(region)).bottom).toBeGreaterThan(expanded.view - 40);
  await toggle.click();
  await expect(toggle).toHaveText("Full brief");
  await settle(page, region);
  expect(Math.abs((await place(region)).past)).toBeLessThanOrEqual(1);
});
