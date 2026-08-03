(() => {
  const mode = new URLSearchParams(location.search).get('mode') || 'playing';
  const frame = document.getElementById('popup');
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    doc.documentElement.dataset.theme = 'dark';
    doc.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const set = (id, value) => { const node = doc.getElementById(id); if (node) node.textContent = value; };
    if (mode === 'insights') {
      setTimeout(() => {
        const win = frame.contentWindow;
        const dateKey = date => {
          const value = new Date(date);
          return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        };
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        const records = {};
        const dailyMinutes = [[74, 18], [96, 24], [52, 34], [118, 20], [88, 42], [132, 36], [64, 28]];
        dailyMinutes.forEach(([active, passive], index) => {
          const day = new Date(monday);
          day.setDate(monday.getDate() + index);
          records[dateKey(day)] = { active: active * 60, passive: passive * 60 };
        });
        for (let offset = 8; offset <= 18; offset += 2) {
          const day = new Date(today);
          day.setDate(today.getDate() - offset);
          records[dateKey(day)] = { active: (38 + offset) * 60, passive: (12 + offset) * 60 };
        }
        const state = {
          records,
          sourceTotals: { ja: {
            youtube: { active: 43800, passive: 16200 },
            netflix: { active: 25200, passive: 19800 },
            reading: { active: 14400, passive: 0 },
            primevideo: { active: 9000, passive: 7200 }
          } },
          sessions: Object.fromEntries([
            ['Tokyo morning vlog', 'youtube', 74, 18],
            ['Japanese drama · Episode 6', 'netflix', 52, 34],
            ['News listening practice', 'youtube', 45, 12],
            ['Short-story reading', 'reading', 38, 0],
            ['Japanese film night', 'primevideo', 64, 28]
          ].map(([title, site, active, passive], index) => {
            const day = new Date(today);
            day.setDate(today.getDate() - index);
            const key = dateKey(day);
            return [`demo-${index}`, { title, site, languageCode: 'ja', startedAt: day.getTime(), lastAt: day.getTime(), byDate: { [key]: { active: active * 60, passive: passive * 60 } } }];
          })),
          preferences: {
            targetLanguage: { code: 'ja', name: 'Japanese' },
            historyLimit: 5,
            goalCountingMode: 'both',
            goals: { daily: { enabled: true, minutes: 120 }, weekly: { enabled: true, minutes: 700 } }
          }
        };
        win.renderCalendar(state);
        win.renderInsights(state);
        win.renderHistory(state);
        doc.getElementById('historyLimit').value = '5';
        doc.querySelectorAll('.tab-panel').forEach(panel => {
          panel.hidden = panel.id !== 'insightsPanel';
          panel.classList.toggle('active', panel.id === 'insightsPanel');
        });
        doc.querySelectorAll('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tabTarget === 'insightsPanel'));
        doc.body.scrollTop = 0;
        frame.dataset.ready = 'true';
      }, 350);
      return;
    }
    set('currentTitle', '日本語の一日｜東京で暮らす社会人のVlog');
    set('currentLanguageHint', 'Japanese');
    set('sessionActive', mode === 'detected' ? '38 min' : '24 min');
    set('sessionPassive', mode === 'detected' ? '12 min' : '8 min');
    set('goalProgressValue', mode === 'detected' ? '178' : '160');
    set('goalProgressTarget', 'of 240 min');
    set('goalProgressPercent', mode === 'detected' ? '74%' : '67%');
    set('goalProgressRemaining', mode === 'detected' ? '62 minutes remaining' : '80 minutes remaining');
    set('goalActiveValue', mode === 'detected' ? '126m' : '112m');
    set('goalPassiveValue', mode === 'detected' ? '52m' : '48m');
    set('automaticEvidence', mode === 'detected' ? 'Japanese detected · Tracking active' : 'Japanese audio detected · Playing now');
    const ring = doc.getElementById('goalProgressRing');
    if (ring) { ring.style.setProperty('--active-angle', mode === 'detected' ? '189deg' : '168deg'); ring.style.setProperty('--passive-angle', mode === 'detected' ? '267deg' : '241deg'); ring.setAttribute('aria-label','74% of today’s goal complete'); }
    const card = doc.getElementById('automaticSessionCard');
    if (card) card.style.boxShadow = '0 0 0 1px rgba(74,222,128,.32),0 18px 45px rgba(0,0,0,.28)';
    doc.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== 'trackerPanel'; p.classList.toggle('active', p.id === 'trackerPanel'); });
    doc.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tabTarget === 'trackerPanel'));
    frame.dataset.ready = 'true';
  });
})();
