/* AlgaAle — search & browse enhancements (vanilla JS, progressive enhancement).
   All filtering happens server-side via GET; this only adds popovers,
   autocomplete, carousels, the mobile bottom sheet and the home tabs. */
(function () {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  // -----------------------------------------------------------------------
  // Search bar: popovers, autocomplete, term/daily, guests stepper
  // -----------------------------------------------------------------------
  function initSearchBar(bar) {
    var openPopover = null;

    function closeAll() {
      $$('.sb-popover', bar).forEach(function (p) { p.hidden = true; });
      $$('.sb-trigger[aria-expanded="true"], .sb-seg', bar).forEach(function (t) {
        if (t.setAttribute) t.setAttribute('aria-expanded', 'false');
      });
      openPopover = null;
    }
    function toggle(pop, trigger) {
      if (openPopover === pop) { closeAll(); return; }
      closeAll();
      pop.hidden = false;
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      openPopover = pop;
    }

    // --- Location autocomplete (Trip.com style: popular areas on focus,
    //     highlighted matches while typing) ---
    var qInput   = $('[data-sb-q]', bar);
    var areaHid  = $('[data-sb-area]', bar);
    var acBox    = $('[data-sb-autocomplete]', bar);
    var areas    = (bar.getAttribute('data-areas') || '').split('|').filter(Boolean);

    var PIN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

    function acItem(a, val) {
      var name = a;
      if (val) {
        var idx = a.toLowerCase().indexOf(val);
        if (idx > -1) {
          name = a.slice(0, idx) + '<strong>' + a.slice(idx, idx + val.length) + '</strong>' + a.slice(idx + val.length);
        }
      }
      return '<button type="button" class="sb-opt sb-ac-opt" data-area="' + a + '">' +
        PIN_SVG +
        '<span class="sb-ac-text"><span class="sb-ac-name">' + name + '</span>' +
        '<span class="sb-ac-sub">Addis Ababa, Ethiopia</span></span></button>';
    }

    function renderAc() {
      var val = qInput.value.trim().toLowerCase();
      // exact match sets hidden area, otherwise clear it
      var exact = areas.filter(function (a) { return a.toLowerCase() === val; })[0];
      areaHid.value = exact || '';
      var matches = val
        ? areas.filter(function (a) { return a.toLowerCase().indexOf(val) > -1; })
        : areas;
      if (!matches.length) {
        acBox.innerHTML = '<div class="sb-ac-head">No matching area — we\'ll search everywhere for “' + qInput.value.trim() + '”</div>';
        acBox.hidden = false;
        return;
      }
      var head = val ? 'Areas in Addis Ababa' : 'Popular areas in Addis Ababa';
      acBox.innerHTML = '<div class="sb-ac-head">' + head + '</div>' +
        matches.map(function (a) { return acItem(a, val); }).join('');
      acBox.hidden = false;
    }
    if (qInput && acBox) {
      qInput.addEventListener('input', renderAc);
      qInput.addEventListener('focus', renderAc);
      acBox.addEventListener('click', function (e) {
        var b = e.target.closest('[data-area]');
        if (!b) return;
        qInput.value = b.getAttribute('data-area');
        areaHid.value = b.getAttribute('data-area');
        acBox.hidden = true;
      });
    }

    // --- Rental term popover ---
    var termTrigger = $('[data-sb-term-trigger]', bar);
    var termPop     = $('[data-sb-term-popover]', bar);
    var termLabel   = $('[data-sb-term-label]', bar);
    var periodHid   = $('[data-sb-period]', bar);
    var checkin     = $('[data-sb-checkin]', bar);
    var checkout    = $('[data-sb-checkout]', bar);
    var calBox      = $('[data-sb-calendar]', bar);

    function refreshTerm() {
      var val = periodHid.value || 'monthly';
      var isDaily = val === 'daily';
      bar.classList.toggle('is-daily', isDaily);
      if (isDaily) {
        termLabel.textContent = daySummary();
      } else {
        termLabel.textContent = val.charAt(0).toUpperCase() + val.slice(1);
      }
    }
    function daySummary() {
      if (checkin && checkin.value && checkout && checkout.value) {
        var a = new Date(checkin.value), b = new Date(checkout.value);
        var nights = Math.max(0, Math.round((b - a) / 86400000));
        var fmt = function (d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
        return fmt(a) + ' → ' + fmt(b) + ' · ' + nights + ' night' + (nights === 1 ? '' : 's');
      }
      return 'Daily';
    }
    if (termTrigger && termPop) {
      termTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        // When Daily is already active, the segment IS the date picker
        if (periodHid.value === 'daily' && calBox) { openCalendar(); return; }
        toggle(termPop, termTrigger);
      });
      termPop.addEventListener('click', function (e) {
        var b = e.target.closest('[data-period]');
        if (!b) return;
        periodHid.value = b.getAttribute('data-period');
        $$('.sb-opt', termPop).forEach(function (o) { o.classList.remove('is-active'); });
        b.classList.add('is-active');
        refreshTerm();
        // Daily → go straight to the check-in/check-out calendar
        if (periodHid.value === 'daily' && calBox) openCalendar();
        else closeAll();
      });
      refreshTerm();
    }

    // --- Trip.com-style range calendar (Daily term) ---
    // First click = check-in, second click = check-out; the stay is
    // highlighted and the night count is computed live.
    var calView = null;   // first day of the left visible month

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function nightsCount() {
      if (!checkin.value || !checkout.value) return 0;
      return Math.max(0, Math.round((fromIso(checkout.value) - fromIso(checkin.value)) / 86400000));
    }

    function openCalendar() {
      if (!calBox) return;
      closeAll();
      renderCal();
      calBox.hidden = false;
      if (termTrigger) termTrigger.setAttribute('aria-expanded', 'true');
      openPopover = calBox;
    }

    function renderCal() {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (!calView) {
        var base = checkin.value ? fromIso(checkin.value) : new Date();
        calView = new Date(base.getFullYear(), base.getMonth(), 1);
      }
      var ci = checkin.value, co = checkout.value;
      var hint = !ci ? 'Select your check-in date'
        : !co ? 'Please select a check-out date'
        : daySummary();

      var html =
        '<div class="sb-cal-terms">' +
          ['daily', 'weekly', 'monthly'].map(function (t) {
            return '<button type="button" class="sb-cal-term ' + (periodHid.value === t ? 'is-active' : '') + '" data-cal-term="' + t + '">' +
              t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="sb-cal-top">' +
          '<button type="button" class="sb-cal-nav" data-cal-prev aria-label="Previous month">&#8249;</button>' +
          '<span class="sb-cal-hint">' + hint + '</span>' +
          '<button type="button" class="sb-cal-nav" data-cal-next aria-label="Next month">&#8250;</button>' +
        '</div><div class="sb-cal-months">';

      for (var m = 0; m < 2; m++) {
        var first = new Date(calView.getFullYear(), calView.getMonth() + m, 1);
        html += '<div class="sb-cal-month"><div class="sb-cal-title">' +
          first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) +
          '</div><div class="sb-cal-grid">';
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (w) { html += '<span class="sb-cal-wd">' + w + '</span>'; });
        for (var b = 0; b < first.getDay(); b++) html += '<span></span>';
        var days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        for (var d = 1; d <= days; d++) {
          var dt = new Date(first.getFullYear(), first.getMonth(), d);
          var s = isoDate(dt);
          var cls = 'sb-cal-day';
          var past = dt < today;
          if (past) cls += ' is-disabled';
          if (s === ci) cls += ' is-checkin';
          if (s === co) cls += ' is-checkout';
          if (ci && co && s > ci && s < co) cls += ' in-range';
          html += '<button type="button" class="' + cls + '" data-cal-day="' + s + '"' + (past ? ' disabled' : '') + '>' + d + '</button>';
        }
        html += '</div></div>';
      }

      var nights = nightsCount();
      html += '</div><div class="sb-cal-foot">' +
        '<button type="button" class="sb-cal-clear" data-cal-clear>Clear dates</button>' +
        '<button type="button" class="sb-cal-done" data-cal-done' + ((ci && co) ? '' : ' disabled') + '>' +
          ((ci && co) ? 'Done · ' + nights + ' night' + (nights === 1 ? '' : 's') : 'Done') +
        '</button></div>';

      calBox.innerHTML = html;
    }

    if (calBox) {
      calBox.addEventListener('click', function (e) {
        e.stopPropagation();
        var day = e.target.closest('[data-cal-day]');
        if (day && !day.disabled) {
          var s = day.getAttribute('data-cal-day');
          if (!checkin.value || (checkin.value && checkout.value)) {
            // fresh pick (or re-pick after a completed range): set check-in
            checkin.value = s; checkout.value = '';
          } else if (s > checkin.value) {
            checkout.value = s;
          } else {
            // clicked on/before the current check-in: restart from there
            checkin.value = s; checkout.value = '';
          }
          clearDateError(); refreshTerm(); renderCal();
          return;
        }
        var term = e.target.closest('[data-cal-term]');
        if (term) {
          periodHid.value = term.getAttribute('data-cal-term');
          $$('.sb-opt', termPop).forEach(function (o) {
            o.classList.toggle('is-active', o.getAttribute('data-period') === periodHid.value);
          });
          refreshTerm();
          if (periodHid.value === 'daily') renderCal(); else closeAll();
          return;
        }
        if (e.target.closest('[data-cal-prev]')) { calView = new Date(calView.getFullYear(), calView.getMonth() - 1, 1); renderCal(); return; }
        if (e.target.closest('[data-cal-next]')) { calView = new Date(calView.getFullYear(), calView.getMonth() + 1, 1); renderCal(); return; }
        if (e.target.closest('[data-cal-clear]')) { checkin.value = ''; checkout.value = ''; refreshTerm(); renderCal(); return; }
        if (e.target.closest('[data-cal-done]')) { if (checkin.value && checkout.value) closeAll(); }
      });
    }

    // --- Daily-term date validation: don't search without both dates ---
    var dateError = $('[data-sb-date-error]', bar);

    function clearDateError() {
      if (dateError) dateError.hidden = true;
    }
    function showDateError(msg) {
      if (dateError) { dateError.textContent = msg; dateError.hidden = false; }
      openCalendar();   // put the user right where they can fix it
    }

    // --- Who popover + guest stepper ---
    var whoTrigger = $('[data-sb-who-trigger]', bar);
    var whoPop     = $('[data-sb-who-popover]', bar);
    var whoLabel   = $('[data-sb-who-label]', bar);
    var guestsHid  = $('[data-sb-guests]', bar);
    var guestCount = $('[data-sb-guest-count]', bar);
    var audience   = $('[data-sb-audience]', bar);

    function refreshWho() {
      var n = parseInt(guestsHid.value, 10) || 1;
      var txt = n + ' ' + (n === 1 ? 'person' : 'people');
      if (audience && audience.value) {
        txt += ' · ' + audience.options[audience.selectedIndex].text;
      }
      whoLabel.textContent = txt;
    }
    if (whoTrigger && whoPop) {
      whoTrigger.addEventListener('click', function (e) { e.stopPropagation(); toggle(whoPop, whoTrigger); });
      whoPop.addEventListener('click', function (e) { e.stopPropagation(); });
      var minus = $('[data-sb-guest-minus]', bar), plus = $('[data-sb-guest-plus]', bar);
      if (minus) minus.addEventListener('click', function () {
        var n = Math.max(1, (parseInt(guestsHid.value, 10) || 1) - 1);
        guestsHid.value = n; guestCount.textContent = n; refreshWho();
      });
      if (plus) plus.addEventListener('click', function () {
        var n = (parseInt(guestsHid.value, 10) || 1) + 1;
        guestsHid.value = n; guestCount.textContent = n; refreshWho();
      });
      if (audience) audience.addEventListener('change', refreshWho);
      refreshWho();
    }

    // Close popovers on outside click / Esc
    document.addEventListener('click', function (e) {
      if (!bar.contains(e.target)) { closeAll(); if (acBox) acBox.hidden = true; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeAll(); if (acBox) acBox.hidden = true; }
    });
    bar.addEventListener('submit', function (e) {
      if (periodHid && periodHid.value === 'daily') {
        if (!checkin || !checkin.value) {
          e.preventDefault();
          showDateError('Please choose a check-in date.', checkin);
          return;
        }
        if (!checkout || !checkout.value) {
          e.preventDefault();
          showDateError('Please choose a check-out date.', checkout);
          return;
        }
        if (checkout.value <= checkin.value) {
          e.preventDefault();
          showDateError('Check-out must be after check-in.', checkout);
          return;
        }
      }
      clearDateError();
    });
  }

  // -----------------------------------------------------------------------
  // Home: "Popular in Addis Ababa" tabs
  // -----------------------------------------------------------------------
  function initPopularTabs() {
    var wrap = $('[data-popular-tabs]');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.popular-tab');
      if (!btn) return;
      var area = btn.getAttribute('data-tab');
      $$('.popular-tab').forEach(function (t) { t.classList.toggle('is-active', t === btn); });
      $$('.popular-panel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-panel') === area);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Results: photo carousels
  // -----------------------------------------------------------------------
  function initCarousels() {
    $$('[data-carousel]').forEach(function (c) {
      var track = $('[data-track]', c);
      var slides = $$('.carousel-slide', track);
      if (slides.length < 2) return;
      var dots = $$('.dot', c);
      var i = 0;
      function go(n) {
        i = (n + slides.length) % slides.length;
        track.style.transform = 'translateX(' + (-i * 100) + '%)';
        dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
      }
      var prev = $('[data-prev]', c), next = $('[data-next]', c);
      if (prev) prev.addEventListener('click', function (e) { e.preventDefault(); go(i - 1); });
      if (next) next.addEventListener('click', function (e) { e.preventDefault(); go(i + 1); });
      dots.forEach(function (d, di) { d.addEventListener('click', function () { go(di); }); });
    });
  }

  // -----------------------------------------------------------------------
  // Results: save/heart (localStorage only for now)
  // -----------------------------------------------------------------------
  function initSaves() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem('alga_saved') || '[]'); } catch (_) { saved = []; }
    $$('[data-save]').forEach(function (btn) {
      var id = btn.getAttribute('data-save');
      if (saved.indexOf(id) > -1) { btn.classList.add('is-saved'); btn.textContent = '♥'; }
      btn.addEventListener('click', function () {
        var idx = saved.indexOf(id);
        if (idx > -1) { saved.splice(idx, 1); btn.classList.remove('is-saved'); btn.textContent = '♡'; }
        else { saved.push(id); btn.classList.add('is-saved'); btn.textContent = '♥'; }
        try { localStorage.setItem('alga_saved', JSON.stringify(saved)); } catch (_) {}
      });
    });
  }

  // -----------------------------------------------------------------------
  // Results: sidebar auto-submit, budget slider, quick ranges, sort
  // -----------------------------------------------------------------------
  function sheetOpen() { return document.body.classList.contains('sheet-open'); }

  function initFilters() {
    var form = $('[data-filter-form]');
    if (!form) return;

    function submit() { if (!sheetOpen()) form.submit(); }

    $$('[data-autofilter]', form).forEach(function (el) {
      var evt = (el.type === 'range') ? 'change' : 'change';
      el.addEventListener(evt, submit);
    });

    // Budget slider live label + clears minPrice when using the slider
    var range = $('[data-budget-range]', form);
    var label = $('[data-budget-label]', form);
    var minP  = $('[data-min-price]', form);
    if (range && label) {
      range.addEventListener('input', function () {
        var v = parseInt(range.value, 10);
        label.textContent = v >= 20000 ? '20,000+' : v.toLocaleString('en-US');
        if (minP) minP.value = '';
      });
    }

    // Quick range buttons
    $$('.qbtn', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-range').split('-');
        if (minP) minP.value = parts[0] || '';
        if (range) range.value = parts[1] || 20000;
        submit();
      });
    });

    // Desktop sort belongs to the filter form via form="filterForm"; keep the
    // hidden sort in sync then submit.
    var dsort = $('[data-desktop-sort]');
    var hsort = $('[data-sort-hidden]', form);
    if (dsort) dsort.addEventListener('change', function () {
      if (hsort) hsort.value = dsort.value;
      form.submit();
    });
  }

  // -----------------------------------------------------------------------
  // Mobile: bottom sheet + filter pills
  // -----------------------------------------------------------------------
  function setParam(name, value) {
    var url = new URL(window.location.href);
    if (value === null || value === '' || value === false) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.location.href = url.toString();
  }

  function initMobile() {
    var backdrop = $('[data-sheet-backdrop]');
    function open()  { document.body.classList.add('sheet-open'); if (backdrop) backdrop.hidden = false; }
    function close() { document.body.classList.remove('sheet-open'); if (backdrop) backdrop.hidden = true; }

    $$('[data-open-sheet]').forEach(function (b) { b.addEventListener('click', open); });
    $$('[data-close-sheet]').forEach(function (b) { b.addEventListener('click', close); });
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // Toggle pills flip a query param and reload
    $$('[data-toggle-param]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.getAttribute('data-toggle-param');
        setParam(name, b.classList.contains('is-on') ? null : 'on');
      });
    });

    var msort = $('[data-mobile-sort]');
    if (msort) msort.addEventListener('change', function () { setParam('sort', msort.value); });
  }

  // -----------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    $$('[data-searchbar]').forEach(initSearchBar);
    initPopularTabs();
    initCarousels();
    initSaves();
    initFilters();
    initMobile();
  });
})();
