const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.log("Onboarding UI checks skipped: run npm install to enable Playwright tests.");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9100 + Math.floor(Math.random() * 400);
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

async function assertNoPopupOverflow(page, label) {
  const result = await page.evaluate(() => {
    const viewportIssues = [...document.querySelectorAll("button,input,select,.surface,dialog[open]")].flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      return rect.left < -1 || rect.right > innerWidth + 1
        ? [{ element: element.id || element.className || element.tagName, rect: [rect.left, rect.right] }]
        : [];
    });
    const boxIssues = [...document.querySelectorAll(".surface button,.surface input,.surface select,dialog[open] button,dialog[open] input,dialog[open] select")].flatMap(element => {
      const container = element.closest(".surface,dialog");
      const rect = element.getBoundingClientRect();
      const box = container?.getBoundingClientRect();
      if (!box || !rect.width || !rect.height) return [];
      const verticalOutside = container.tagName !== "DIALOG" && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1);
      return rect.left < box.left - 1 || rect.right > box.right + 1 || verticalOutside
        ? [{ element: element.id || element.className || element.tagName, container: container.id || container.className }]
        : [];
    });
    return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportIssues, boxIssues };
  });
  assert(result.documentWidth <= result.viewportWidth, `${label}: popup document should not scroll horizontally`);
  assert.deepEqual(result.viewportIssues, [], `${label}: controls should stay inside the popup viewport: ${JSON.stringify(result.viewportIssues)}`);
  assert.deepEqual(result.boxIssues, [], `${label}: controls should stay inside their card or dialog: ${JSON.stringify(result.boxIssues)}`);
}

async function assertDashboardLayout(page, label) {
  const result = await page.evaluate(() => {
    const active = document.querySelector(".view.active");
    const containmentIssues = [...active.querySelectorAll(".days>div,.highlight,button,input,select")].flatMap(element => {
      const container = element.closest(".panel");
      const rect = element.getBoundingClientRect();
      const box = container?.getBoundingClientRect();
      if (!box || !rect.width || !rect.height) return [];
      return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1
        ? [{ element: element.id || element.className || element.tagName, container: container.className }]
        : [];
    });
    const main = document.querySelector("main");
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      mainOverflow: main.scrollHeight > main.clientHeight + 1,
      containmentIssues
    };
  });
  assert(result.pageWidth <= result.viewportWidth, `${label}: dashboard should not scroll horizontally`);
  assert.equal(result.mainOverflow, false, `${label}: dashboard should fit a 1280x800 viewport without hidden vertical content`);
  assert.deepEqual(result.containmentIssues, [], `${label}: dashboard content should remain inside its panel: ${JSON.stringify(result.containmentIssues)}`);
}

async function assertPopupPairsAlign(page, pairs, label) {
  const differences = await page.evaluate(selectors => selectors.map(([left, right]) => {
    const leftBox = document.querySelector(left)?.getBoundingClientRect();
    const rightBox = document.querySelector(right)?.getBoundingClientRect();
    return leftBox && rightBox ? Math.abs(leftBox.bottom - rightBox.bottom) : Infinity;
  }), pairs);
  assert(differences.every(value => value <= 1), `${label}: paired cards should end on the same baseline: ${differences.join(", ")}`);
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {})
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://127.0.0.1:${port}/popup.html?new=1`, { waitUntil: "networkidle" });
    await page.locator("#onboardingDialog[open]").waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "the added account control must not overflow the popup header");
    assert.equal(await page.locator("#onboardingStepLabel").textContent(), "Step 1 of 5");
    await page.locator("#onboardingNextButton").click();
    assert.equal(await page.locator("#onboardingStepLabel").textContent(), "Step 2 of 5");
    await page.locator("#onboardingChooseLater").click();
    assert.equal(await page.locator("#onboardingStepLabel").textContent(), "Step 3 of 5");
    await page.locator("#onboardingNextButton").click();
    assert.equal(await page.locator("#onboardingStepLabel").textContent(), "Step 4 of 5");
    assert(await page.locator("#onboardingDialog").getByText("Multi-language planned").isVisible());
    assert(await page.locator("#onboardingDialog").getByText("No payment or login is required yet.").isVisible());
    const comparisonFits = await page.locator(".onboarding-plan-comparison").evaluate(element =>
      element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= innerWidth
    );
    assert(comparisonFits, "onboarding plan comparison should fit the popup");
    await page.locator("#onboardingNextButton").click();
    assert.equal(await page.locator("#onboardingStepLabel").textContent(), "Step 5 of 5");

    await page.goto(`http://127.0.0.1:${port}/popup.html`, { waitUntil: "networkidle" });
    const popupSize = await page.evaluate(() => ({ width: document.documentElement.offsetWidth, height: document.documentElement.offsetHeight }));
    assert.deepEqual(popupSize, { width: 800, height: 600 }, "the normal popup should use Chrome's 800x600 maximum");
    await page.locator("#openAccountInfo").click();
    await page.locator("#accountInfoDialog[open]").waitFor();
    assert(await page.locator("#accountInfoDialog").evaluate(element => element.scrollWidth <= element.clientWidth),
      "account and plan comparison should fit the dialog");
    assert(await page.getByText("No login is required in this version.").isVisible());
    assert(await page.getByText("Switching your active language never deletes earlier language data.").isVisible());
    await page.locator("#accountInfoDialog [data-close-dialog]").click();
    await page.locator("#targetLanguageSelect").selectOption("sv");
    await page.waitForFunction(() => window.__mockCalls.some(call => call.channel === "confirm"));
    const confirmCall = await page.evaluate(() => window.__mockCalls.find(call => call.channel === "confirm"));
    assert(confirmCall.message.includes("history will stay saved"));

    for (const theme of ["dark", "light"]) {
      await page.goto(`http://127.0.0.1:${port}/popup.html?theme=${theme}`, { waitUntil: "networkidle" });
      await assertNoPopupOverflow(page, `popup tracker ${theme}`);
      const activeTabVisuals = [await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector(".tab-button.active"));
        return [style.backgroundColor, style.borderColor, style.outlineStyle, style.boxShadow];
      })];
      await page.locator('[data-tab-target="insightsPanel"]').click();
      await assertNoPopupOverflow(page, `popup insights ${theme}`);
      activeTabVisuals.push(await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector(".tab-button.active"));
        return [style.backgroundColor, style.borderColor, style.outlineStyle, style.boxShadow];
      }));
      const insightGaps = await page.evaluate(() => [...document.querySelectorAll("#insightsPanel > .insights-column")].map(column => {
        const cards = [...column.querySelectorAll(":scope > .surface")];
        return cards.length === 2 ? Math.round(cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom) : Infinity;
      }));
      assert(insightGaps.every(value => value === 12), `popup insights ${theme}: cards should stack with a compact 12px gap: ${insightGaps.join(", ")}`);
      const secondRow = await page.evaluate(() => {
        const source = document.querySelector(".source-score-card").getBoundingClientRect();
        const history = document.querySelector(".history-card").getBoundingClientRect();
        const historyList = document.querySelector(".history-list");
        const historyHeightBefore = history.height;
        const originalHistoryMarkup = historyList.innerHTML;
        const firstItem = historyList.querySelector(".history-item");
        if (firstItem) {
          for (let index = 0; index < 9; index += 1) historyList.append(firstItem.cloneNode(true));
        }
        const historyHeightAfter = document.querySelector(".history-card").getBoundingClientRect().height;
        const historyScrollable = historyList.scrollHeight > historyList.clientHeight;
        historyList.innerHTML = originalHistoryMarkup;
        return {
          topDifference: Math.abs(source.top - history.top),
          heightDifference: Math.abs(source.height - history.height),
          bottomDifference: Math.abs(source.bottom - history.bottom),
          historyOverflow: getComputedStyle(historyList).overflowY,
          historyHeightChange: Math.abs(historyHeightAfter - historyHeightBefore),
          historyScrollable
        };
      });
      assert(secondRow.bottomDifference <= 1 && secondRow.historyOverflow === "auto" && secondRow.historyHeightChange <= 1 && secondRow.historyScrollable, `popup insights ${theme}: source and History cards must share a bottom edge, and History must keep a fixed size while ten rows scroll: ${JSON.stringify(secondRow)}`);
      if (process.env.POPUP_INSIGHTS_AUDIT && theme === "dark") {
        await page.evaluate(() => { document.body.scrollTop = document.body.scrollHeight; });
        await page.screenshot({ path: process.env.POPUP_INSIGHTS_AUDIT, type: "png" });
      }
      const emptyChart = await page.evaluate(() => {
        renderInsights({ ...window.__mockState, records: {} });
        const chart = document.getElementById("weeklyChart");
        const emptyState = chart.querySelector(".chart-empty-state");
        return {
          isEmpty: chart.classList.contains("is-empty"),
          invitation: emptyState?.textContent || "",
          baseline: emptyState ? getComputedStyle(emptyState, "::before").backgroundImage : "none"
        };
      });
      assert(emptyChart.isEmpty && emptyChart.invitation.includes("Your week starts"), `popup insights ${theme}: empty weekly chart needs invitation copy`);
      assert(emptyChart.baseline && emptyChart.baseline !== "none", `popup insights ${theme}: empty weekly chart needs a quiet baseline`);
      await page.locator('[data-tab-target="manualPanel"]').click();
      await assertNoPopupOverflow(page, `popup manual ${theme}`);
      activeTabVisuals.push(await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector(".tab-button.active"));
        return [style.backgroundColor, style.borderColor, style.outlineStyle, style.boxShadow];
      }));
      assert(activeTabVisuals.every(style => JSON.stringify(style) === JSON.stringify(activeTabVisuals[0])), `popup ${theme}: every active tab must render identically: ${JSON.stringify(activeTabVisuals)}`);
      await assertPopupPairsAlign(page, [[".manual-card", ".quick-add-card"]], `popup manual ${theme}`);
      const componentAudit = await page.evaluate(() => {
        const style = selector => getComputedStyle(document.querySelector(selector));
        const tabWidths = [...document.querySelectorAll(".tab-button")].map(node => node.getBoundingClientRect().width);
        const icons = [...document.querySelectorAll(".header-actions .icon-button")].map(node => {
          const computed = getComputedStyle(node);
          return [computed.width, computed.height, computed.borderRadius];
        });
        return {
          tabWidths,
          icons,
          startBackground: style("#startManualButton").backgroundColor,
          addBackground: style("#customImmersionForm button.primary").backgroundColor,
          timerFont: style("#manualElapsed").fontFamily,
          historyFont: document.querySelector(".history-item span") ? style(".history-item span").fontFamily : "",
          historyText: document.querySelector(".history-item span")?.textContent || "",
          startButton: (() => { const box = document.querySelector("#startManualButton").getBoundingClientRect(); return [box.width, box.height, box.bottom]; })(),
          addButton: (() => { const box = document.querySelector("#customImmersionForm button.primary").getBoundingClientRect(); return [box.width, box.height, box.bottom]; })(),
          startFieldGap: (() => {
            const button = document.querySelector("#startManualButton").getBoundingClientRect();
            const fields = ["#manualSource", "#manualMode"].map(selector => document.querySelector(selector).getBoundingClientRect());
            return button.top - Math.max(...fields.map(box => box.bottom));
          })(),
          addFieldGap: (() => {
            const button = document.querySelector("#customImmersionForm button.primary").getBoundingClientRect();
            const fields = ["#customHours", "#customMinutes"].map(selector => document.querySelector(selector).getBoundingClientRect());
            return button.top - Math.max(...fields.map(box => box.bottom));
          })()
        };
      });
      assert(Math.max(...componentAudit.tabWidths) - Math.min(...componentAudit.tabWidths) <= 1, `popup ${theme}: tab segments must have fixed equal widths`);
      assert(componentAudit.icons.every(icon => JSON.stringify(icon) === JSON.stringify(componentAudit.icons[0])), `popup ${theme}: header icon buttons must share one component style: ${JSON.stringify(componentAudit.icons)}`);
      assert.equal(componentAudit.startBackground, componentAudit.addBackground, `popup ${theme}: primary actions must use one fill token`);
      assert(Math.abs(componentAudit.startButton[0] - componentAudit.addButton[0]) <= 1 && Math.abs(componentAudit.startButton[1] - componentAudit.addButton[1]) <= 1 && Math.abs(componentAudit.startButton[2] - componentAudit.addButton[2]) <= 1, `popup ${theme}: Manual primary buttons must share width, height, and baseline: ${JSON.stringify([componentAudit.startButton, componentAudit.addButton])}`);
      assert(componentAudit.startFieldGap >= 12 && componentAudit.addFieldGap >= 10, `popup ${theme}: Manual actions need clear space below their fields: ${JSON.stringify([componentAudit.startFieldGap, componentAudit.addFieldGap])}`);
      assert(componentAudit.timerFont.includes("IBM Plex Mono") && componentAudit.historyFont.includes("IBM Plex Mono"), `popup ${theme}: durations and History metadata must use IBM Plex Mono`);
      assert(componentAudit.historyText.includes("Active") && componentAudit.historyText.includes("Passive") && !componentAudit.historyText.includes(" - A "), `popup ${theme}: History must use full type labels`);
      await page.locator("#openGeneralSettings").click();
      await page.locator("#generalSettingsDialog[open]").waitFor();
      await assertNoPopupOverflow(page, `popup settings dialog ${theme}`);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const theme of ["dark", "light"]) {
      for (const view of ["stats", "history", "pro", "settings"]) {
        await page.goto(`http://127.0.0.1:${port}/store-assets/dashboard.html?view=${view}&demo=1&theme=${theme}`, { waitUntil: "networkidle" });
        await page.locator(`#${view}.active`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await assertDashboardLayout(page, `dashboard ${view} ${theme}`);
        if (view === "stats") {
          assert(await page.locator(".calendar-key").isVisible(), "dashboard calendar legend should be visible");
          const dashboardEmptyChart = await page.evaluate(() => {
            renderStats({ ...(latestDashboard?.state || {}), records: {}, dailyRecords: {} });
            const emptyState = document.querySelector("#bars .chart-empty-state");
            return {
              invitation: emptyState?.textContent || "",
              baseline: emptyState ? getComputedStyle(emptyState, "::before").backgroundImage : "none"
            };
          });
          assert(dashboardEmptyChart.invitation.includes("Your week starts") && dashboardEmptyChart.baseline !== "none", `dashboard ${theme}: empty weekly chart must use the shared invitation and baseline`);
        }
      }
    }
    console.log("Onboarding and account UI checks passed.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.kill());
