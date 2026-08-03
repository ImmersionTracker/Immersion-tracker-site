const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.log("Dashboard UI checks skipped: run npm install to enable Playwright tests.");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9500 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [path.join(__dirname, "ui-test-server.js")], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("UI test server did not start")), 5000);
    server.stdout.on("data", data => {
      if (!String(data).includes("UI test server listening")) return;
      clearTimeout(timer);
      resolve();
    });
    server.stderr.on("data", data => reject(new Error(String(data))));
    server.on("exit", code => code && reject(new Error(`UI test server exited with ${code}`)));
  });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    for (const view of ["stats", "history", "pro", "settings"]) {
      await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=${view}&demo=1`, { waitUntil: "networkidle" });
      await page.locator(`#${view}.active`).waitFor();
      await page.evaluate(() => document.fonts.ready);

      const layout = await page.evaluate(() => {
        const main = document.querySelector("main");
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          mainOverflow: main.scrollHeight > main.clientHeight + 1,
          mainHeight: [main.scrollHeight, main.clientHeight]
        };
      });
      assert(layout.pageWidth <= layout.viewportWidth, `${view}: dashboard must not scroll horizontally`);
      assert.equal(layout.mainOverflow, false, `${view}: dashboard must fit the desktop viewport (${layout.mainHeight.join("/")})`);
    }

    await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=stats&demo=1`, { waitUntil: "networkidle" });
    const zeroState = await page.evaluate(() => {
      renderStats({ ...(latestDashboard?.state || {}), records: {}, dailyRecords: {} });
      const chart = document.querySelector(".weekly .chart");
      const bars = document.getElementById("bars");
      const invitation = bars.querySelector(".chart-empty-state");
      const invitationBox = invitation?.getBoundingClientRect();
      const weeklyBox = document.querySelector(".weekly").getBoundingClientRect();
      const goalBox = document.querySelector(".goal").getBoundingClientRect();
      return {
        chartEmpty: chart.classList.contains("is-empty"),
        invitation: invitation?.textContent || "",
        invitationVisible: Boolean(invitationBox?.width && invitationBox?.height),
        grid: getComputedStyle(bars).backgroundImage,
        axis: getComputedStyle(chart.querySelector(".axis")).visibility,
        axisLabels: [...chart.querySelectorAll(".axis span")].map(span => span.textContent.trim()),
        goalInsideWeekly: document.querySelector(".weekly #dailyGoalPercent") !== null,
        panelsOverlap: !(weeklyBox.right <= goalBox.left || goalBox.right <= weeklyBox.left || weeklyBox.bottom <= goalBox.top || goalBox.bottom <= weeklyBox.top)
      };
    });
    assert(zeroState.chartEmpty && zeroState.invitationVisible && zeroState.invitation.includes("Your week starts"), `Overview needs a visible weekly zero-state invitation: ${JSON.stringify(zeroState)}`);
    assert.equal(zeroState.grid, "none", "Overview zero-state must remove empty gridlines");
    assert.equal(zeroState.axis, "hidden", "Overview zero-state must remove empty axis labels");
    assert(zeroState.axisLabels.every(label => !label.includes("½")), `Weekly axis labels must use durations: ${zeroState.axisLabels.join(", ")}`);
    assert(!zeroState.goalInsideWeekly && !zeroState.panelsOverlap, "Daily Goal content must remain in its own card");
    const calendarContainment = await page.evaluate(() => {
      const card = document.querySelector(".calendar").getBoundingClientRect();
      const legend = document.querySelector(".calendar-key").getBoundingClientRect();
      return { cardHeight: card.height, legendBottom: legend.bottom, cardBottom: card.bottom };
    });
    assert(calendarContainment.cardHeight >= 310, `Consistency card must be tall enough for its legend: ${calendarContainment.cardHeight}px`);
    assert(calendarContainment.legendBottom <= calendarContainment.cardBottom - 10, `Consistency legend must remain inside the card: ${JSON.stringify(calendarContainment)}`);

    // Bars used a fixed 180px scale inside a 195px box, so once a day reached the
    // daily goal the value labels were pushed out of the chart and clipped.
    await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=stats&demo=1`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const overGoalChart = await page.evaluate(() => {
      const keys = weekKeys(weekReference());
      // Every day at twice the daily goal - the worst case for label headroom.
      const records = Object.fromEntries(keys.map(key => [key, { active: 43200, passive: 43200 }]));
      renderStats({ ...(latestDashboard?.state || {}), records, dailyRecords: records });
      const barsBox = document.getElementById("bars").getBoundingClientRect();
      const days = [...document.querySelectorAll(".bar-day")];
      const measure = (element) => {
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent.trim(),
          top: box.top, bottom: box.bottom,
          clippedText: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
        };
      };
      return {
        dayCount: days.length,
        bars: barsBox,
        values: days.map(day => measure(day.querySelector("b"))),
        names: days.map(day => measure(day.querySelector("span"))),
        stacks: days.map(day => day.querySelector(".bar-stack").getBoundingClientRect())
      };
    });
    assert.equal(overGoalChart.dayCount, 7, "an over-goal week must still render seven bars");
    for (const [index, label] of [...overGoalChart.values, ...overGoalChart.names].entries()) {
      assert(label.top >= overGoalChart.bars.top - 0.5 && label.bottom <= overGoalChart.bars.bottom + 0.5,
        `weekly chart label ${index} ("${label.text}") escapes the chart box: ${label.top}-${label.bottom} vs ${overGoalChart.bars.top}-${overGoalChart.bars.bottom}`);
      assert(!label.clippedText, `weekly chart label ${index} ("${label.text}") is clipped by its own box`);
    }
    for (const [index, stack] of overGoalChart.stacks.entries()) {
      assert(stack.top >= overGoalChart.values[index].bottom - 0.5,
        `bar ${index} must stay below its value label, not overlap it`);
      assert(stack.height > 0, `bar ${index} must still be drawn at ${stack.height}px`);
    }

    const calendarSurfaces = [
      ["dashboard", "dark", `http://127.0.0.1:${port}/store-assets/dashboard.html?view=stats&demo=1&theme=dark`, "#days > div"],
      ["popup", "dark", `http://127.0.0.1:${port}/popup.html?calendarStates=1&theme=dark`, "#calendarGrid > .calendar-day"],
      ["dashboard", "light", `http://127.0.0.1:${port}/store-assets/dashboard.html?view=stats&demo=1&theme=light`, "#days > div"],
      ["popup", "light", `http://127.0.0.1:${port}/popup.html?calendarStates=1&theme=light`, "#calendarGrid > .calendar-day"]
    ];
    const calendarResults = new Map();
    for (const [surface, theme, url, daySelector] of calendarSurfaces) {
      await page.goto(url, { waitUntil: "networkidle" });
      if (surface === "dashboard") {
        await page.evaluate(() => {
          const reference = now();
          const prefix = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}-`;
          const fixtureMinutes = [90, 180, 270, 330, 360];
          const records = Object.fromEntries(fixtureMinutes.map((minutes, index) => [
            prefix + String(index + 3).padStart(2, "0"),
            { active: minutes * 60, passive: 0 }
          ]));
          renderCalendar(records, 360, 900, false, 0);
        });
      }
      const calendar = await page.evaluate(selector => {
        const days = [...document.querySelectorAll(selector)];
        const states = [1, 2, 3, 4].map(level => days.find(day => day.classList.contains(`level-${level}`)));
        const today = days.find(day => day.classList.contains("today"));
        const weekly = days.filter(day => day.classList.contains("week-complete"));
        const daily = days.find(day => day.classList.contains("daily-complete"));
        const legend = document.querySelector('[aria-label="Calendar status legend"]');
        return {
          levels: states.map(day => day?.className || ""),
          backgrounds: states.map(day => day ? getComputedStyle(day).backgroundImage : "none"),
          daily: daily?.className || "",
          dailyBackground: daily ? getComputedStyle(daily).backgroundImage : "none",
          todayOutline: today ? getComputedStyle(today).outlineStyle : "none",
          weeklyCount: weekly.length,
          // A missing ::after still reports backgroundColor "rgba(0, 0, 0, 0)",
          // so read content/height/insets too - colour alone proves nothing.
          weeklyMarker: weekly[0] ? (() => {
            const after = getComputedStyle(weekly[0], "::after");
            const grid = weekly[0].parentElement;
            return {
              content: after.content,
              backgroundColor: after.backgroundColor,
              height: parseFloat(after.height) || 0,
              left: parseFloat(after.left) || 0,
              right: parseFloat(after.right) || 0,
              columnGap: parseFloat(getComputedStyle(grid).columnGap) || 0
            };
          })() : null,
          weeklyBoxShadow: weekly[0] ? getComputedStyle(weekly[0]).boxShadow : "none",
          legend: legend?.textContent.replace(/\s+/g, " ").trim() || ""
        };
      }, daySelector);
      assert(calendar.levels.every(Boolean) && new Set(calendar.backgrounds).size === 4, `${surface}: calendar needs four distinct recorded-intensity states`);
      assert(calendar.daily.includes("daily-complete"), `${surface}: calendar needs a daily-goal state`);
      assert.notEqual(calendar.todayOutline, "none", `${surface}: calendar must keep today's outline`);
      assert(calendar.weeklyCount >= 7, `${surface}: a completed week must mark all seven days, got ${calendar.weeklyCount}`);
      const marker = calendar.weeklyMarker;
      assert(marker, `${surface}: calendar needs a weekly-goal marker`);
      assert(marker.content !== "none", `${surface}: the weekly-goal marker's ::after must actually render`);
      assert(!/^rgba\(0, 0, 0, 0\)$/.test(marker.backgroundColor) && marker.backgroundColor !== "transparent",
        `${surface}: the weekly-goal marker needs a visible colour, got ${marker.backgroundColor}`);
      assert(marker.height > 0, `${surface}: the weekly-goal marker needs a non-zero height, got ${marker.height}`);
      // The band spans the grid gap only if each cell's overhang covers half of it.
      assert(marker.left < 0 && marker.right < 0 && (-marker.left) * 2 >= marker.columnGap && (-marker.right) * 2 >= marker.columnGap,
        `${surface}: the weekly-goal marker must overhang each cell by at least half the ${marker.columnGap}px grid gap to read as one continuous band, got left ${marker.left}px / right ${marker.right}px`);
      assert(calendar.legend.includes("Recorded") && calendar.legend.includes("More") && calendar.legend.includes("Daily goal met") && calendar.legend.includes("Weekly goal met"), `${surface}: calendar legend must explain every state`);
      calendarResults.set(`${surface}-${theme}`, calendar);
    }
    for (const theme of ["dark", "light"]) {
      const dashboardCalendar = calendarResults.get(`dashboard-${theme}`);
      const popupCalendar = calendarResults.get(`popup-${theme}`);
      assert.deepEqual(popupCalendar.backgrounds, dashboardCalendar.backgrounds, `${theme}: popup and Dashboard intensity colors must match`);
      assert.equal(popupCalendar.dailyBackground, dashboardCalendar.dailyBackground, `${theme}: popup and Dashboard daily-goal colors must match`);
      assert.equal(popupCalendar.weeklyBoxShadow, dashboardCalendar.weeklyBoxShadow, `${theme}: popup and Dashboard weekly-goal treatment must match`);
      // Both surfaces draw the band from the same amber token at the same weight;
      // only the overhang differs, because their grid gaps differ.
      assert.equal(popupCalendar.weeklyMarker.backgroundColor, dashboardCalendar.weeklyMarker.backgroundColor,
        `${theme}: popup and Dashboard weekly-goal band colors must match`);
      assert.equal(popupCalendar.weeklyMarker.height, dashboardCalendar.weeklyMarker.height,
        `${theme}: popup and Dashboard weekly-goal band heights must match`);
    }

    await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=history&demo=1`, { waitUntil: "networkidle" });
    const history = await page.evaluate(() => {
      const table = document.querySelector(".recent table").getBoundingClientRect();
      const activity = document.querySelector("td.activity-title");
      const cell = activity.getBoundingClientRect();
      return {
        display: getComputedStyle(activity).display,
        widthRatio: cell.width / table.width,
        completeTitle: activity.textContent.trim() === activity.title,
        fullHeight: activity.scrollHeight <= activity.clientHeight + 1
      };
    });
    assert.equal(history.display, "table-cell", "History activity titles must remain real table cells");
    assert(history.widthRatio >= .4, `History activity column needs at least 40% of the table, got ${Math.round(history.widthRatio * 100)}%`);
    assert(history.completeTitle && history.fullHeight, "History activity names must render in full without clamping");

    await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=settings&demo=1`, { waitUntil: "networkidle" });
    const settings = await page.evaluate(() => ({
      descriptionSize: parseFloat(getComputedStyle(document.querySelector(".setting span")).fontSize),
      lowerCardBottoms: [document.querySelector(".appearance-card"), document.getElementById("dashboardAccountCard")].map(card => card.getBoundingClientRect().bottom),
      gaps: [...document.querySelectorAll(".settings-card")].map(card => {
        const visibleChildren = [...card.children].filter(child => getComputedStyle(child).display !== "none" && child.getBoundingClientRect().height);
        return card.getBoundingClientRect().bottom - visibleChildren.at(-1).getBoundingClientRect().bottom;
      })
    }));
    assert(settings.descriptionSize >= 12, `Settings descriptions need a 12px desktop minimum, got ${settings.descriptionSize}px`);
    assert(settings.gaps.every(gap => gap <= 20), `Settings cards should size to content: ${settings.gaps.join(", ")}`);
    assert(Math.abs(settings.lowerCardBottoms[0] - settings.lowerCardBottoms[1]) <= 1, `Appearance and Account cards must share a bottom edge: ${settings.lowerCardBottoms.join(", ")}`);

    await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=pro&demo=1`, { waitUntil: "networkidle" });
    const pro = await page.evaluate(() => {
      const bars = document.getElementById("proWeekBars").getBoundingClientRect();
      const weeks = [...document.querySelectorAll(".pro-week")];
      const lastWeek = weeks.at(-1).getBoundingClientRect();
      return {
        weekLabelSize: parseFloat(getComputedStyle(document.querySelector(".pro-week span")).fontSize),
        rightGap: bars.right - lastWeek.right,
        barCount: weeks.length,
        trendLabels: [...document.querySelectorAll("#proTrendAxis span")].map(label => label.textContent.trim()),
        svgDateLabels: document.querySelectorAll("#proTrendChart text").length
      };
    });
    assert(pro.weekLabelSize >= 11, `Pro week labels need an 11px desktop minimum, got ${pro.weekLabelSize}px`);
    assert(pro.barCount && pro.rightGap <= 8, `Available consistency bars should use the card width, right gap was ${pro.rightGap}px`);
    assert(pro.trendLabels.length >= 3 && pro.svgDateLabels === 0, `Pro trend dates must use an unstretched HTML axis: ${JSON.stringify(pro.trendLabels)}`);

    console.log("Dashboard UI checks passed.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.kill());
