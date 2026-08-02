(() => {
  const mode = new URLSearchParams(location.search).get('mode') || 'playing';
  const frame = document.getElementById('popup');
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    doc.documentElement.dataset.theme = 'dark';
    doc.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const set = (id, value) => { const node = doc.getElementById(id); if (node) node.textContent = value; };
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
