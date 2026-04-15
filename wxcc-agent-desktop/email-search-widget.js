/**
 * email-search-widget.js — LIVE DATA version
 * 
 * Webex Contact Center Agent Desktop custom web component.
 * Queries the WxCC Search API (GraphQL /search endpoint) for email tasks.
 *
 * HOSTING OPTIONS (pick one):
 *   • GitHub Pages — push to a public repo, enable Pages, use the raw URL
 *   • Any HTTPS static host (S3+CloudFront, Azure Blob, Netlify, Vercel)
 *   • Your own web server behind HTTPS
 *
 * LAYOUT JSON wires these STORE values into the widget as properties:
 *   bearerToken    → $STORE.auth.accessToken
 *   organizationId → $STORE.agent.orgId  
 *   dataCenter     → $STORE.app.datacenter  (e.g. "us1", "eu1", "anz1")
 */

class EmailSearchWidget extends HTMLElement {

  static get observedAttributes() {
    return ['bearertoken', 'organizationid', 'datacenter'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._q = '';
    this._df = '';          // direction filter
    this._qf = '';          // queue filter
    this._sel = null;       // selected task id
    this._data = [];
    this._loading = false;
    this._err = null;
    this._dt = null;        // debounce timer
    this._init = false;
    this._token = '';
    this._orgId = '';
    this._dc = '';
    this._fetchTimer = null;
  }

  connectedCallback() {
    this._shell();
    // If token is already set (properties can arrive before connectedCallback)
    if (this._token) this._fetch();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'bearertoken') {
      this._token = newVal || '';
      // Token arrived or refreshed — fetch data
      if (this._token && this._init) this._fetch();
    }
    if (name === 'organizationid') this._orgId = newVal || '';
    if (name === 'datacenter') this._dc = newVal || '';
  }

  // Desktop also sets properties directly (not just attributes)
  set bearerToken(v) { this._token = v || ''; if (this._token && this._init) this._fetch(); }
  get bearerToken() { return this._token; }
  set organizationId(v) { this._orgId = v || ''; }
  get organizationId() { return this._orgId; }
  set dataCenter(v) { this._dc = v || ''; }
  get dataCenter() { return this._dc; }
  set interactionData(v) { /* available if needed for context */ }
  set agentId(v) { /* available if needed */ }

  // ═══════════════════════════════════════
  //  API
  // ═══════════════════════════════════════

  get _base() {
    const dc = this._dc || 'us1';
    return 'https://api.wxcc-' + dc + '.cisco.com';
  }

  async _fetch() {
    if (!this._token || !this._orgId) {
      this._err = 'Waiting for authentication...';
      this._upd();
      return;
    }

    this._loading = true;
    this._err = null;
    this._upd();

    const now = Date.now();
    const from = now - (30 * 24 * 60 * 60 * 1000); // 30 days

    // GraphQL query for email channel CSR records
    const query = '{'
      + 'task('
      + '  from:' + from
      + '  to:' + now
      + '  filter:{ channelType:{ equals:"email" } }'
      + '  pagination:{ cursor:"0" }'
      + '){'
      + '  tasks{'
      + '    id channelType direction origin destination status'
      + '    createdTime endedTime queueName wrapupCodeName'
      + '    isEmailHasAttachment emailCc emailSubject contactPriority'
      + '    lastAgent{ name }'
      + '  }'
      + '  pageInfo{ hasNextPage endCursor }'
      + '}'
      + '}';

    try {
      const resp = await fetch(this._base + '/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this._token,
          'organizationId': this._orgId
        },
        body: JSON.stringify({ query: query })
      });

      if (resp.status === 401) {
        this._err = 'Token expired — Desktop should refresh automatically. Try again in a moment.';
        this._loading = false;
        this._upd();
        return;
      }

      if (!resp.ok) {
        throw new Error('Search API returned ' + resp.status + ' ' + resp.statusText);
      }

      const json = await resp.json();
      const tasks = (json && json.data && json.data.task && json.data.task.tasks) || [];

      this._data = tasks.map(function(t) {
        return {
          id: t.id || '',
          dir: (t.direction || '').toUpperCase(),
          from: t.origin || '',
          to: t.destination || '',
          sub: t.emailSubject || '(No subject)',
          queue: t.queueName || '',
          agent: (t.lastAgent && t.lastAgent.name) ? t.lastAgent.name : 'Unassigned',
          wrap: t.wrapupCodeName || '',
          ct: t.createdTime || 0,
          et: t.endedTime || null,
          st: t.status || 'unknown',
          att: !!t.isEmailHasAttachment,
          cc: t.emailCc || '',
          pr: t.contactPriority || 5
        };
      });

      if (this._data.length === 0) {
        this._err = 'No email conversations found in the last 30 days.';
      }

      // Check for next page
      var pi = json.data.task.pageInfo;
      if (pi && pi.hasNextPage) {
        // Could implement pagination here — for now show count note
        this._err = null; // clear
      }

    } catch (e) {
      console.error('[EmailSearchWidget]', e);
      this._err = 'API Error: ' + e.message;
    }

    this._loading = false;
    this._upd();
  }

  // ═══════════════════════════════════════
  //  Filtering
  // ═══════════════════════════════════════

  _filt() {
    var self = this;
    return this._data.filter(function(e) {
      if (self._df && e.dir !== self._df) return false;
      if (self._qf && e.queue !== self._qf) return false;
      if (self._q.length >= 2) {
        var s = self._q.toLowerCase();
        return [e.sub, e.from, e.to, e.wrap, e.agent, e.queue, e.id]
          .some(function(f) { return (f || '').toLowerCase().indexOf(s) !== -1; });
      }
      return true;
    });
  }

  _queues() {
    var s = {};
    this._data.forEach(function(e) { if (e.queue) s[e.queue] = 1; });
    return Object.keys(s).sort();
  }

  // ═══════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════

  _esc(s) { var e = document.createElement('span'); e.textContent = s || ''; return e.innerHTML; }

  _hl(t, q) {
    if (!q || q.length < 2 || !t) return this._esc(t);
    var esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this._esc(t).replace(new RegExp('(' + esc + ')', 'gi'), '<mark>$1</mark>');
  }

  _ft(ep) {
    if (!ep) return '\u2014';
    var d = new Date(ep);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  _fd(s, e) {
    if (!s || !e) return 'Active';
    var m = Math.round((e - s) / 60000);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  _pc(p) {
    if (p <= 1) return '#FF1744'; if (p <= 2) return '#FF5252';
    if (p <= 3) return '#FF9100'; if (p <= 4) return '#FFB300'; return '#78909C';
  }

  // ═══════════════════════════════════════
  //  Build shell ONCE
  // ═══════════════════════════════════════

  _shell() {
    if (this._init) return;
    this._init = true;
    var self = this;

    this.shadowRoot.innerHTML =
      '<style>' +
      ':host{display:block;width:100%;height:100%;font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;color:#E0E0E0;background:#07080D;overflow:hidden}' +
      '*{box-sizing:border-box}' +
      '.root{display:flex;flex-direction:column;height:100%}' +
      '.hdr{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}' +
      '.hdr-l{display:flex;align-items:center;gap:8px}' +
      '.hdr-ico{width:26px;height:26px;border-radius:6px;background:linear-gradient(135deg,rgba(0,176,255,.15),rgba(124,77,255,.15));border:1px solid rgba(0,176,255,.2);display:flex;align-items:center;justify-content:center;font-size:13px}' +
      '.hdr-t{font-size:12px;font-weight:700}.hdr-s{font-size:9px;color:rgba(255,255,255,.25);font-family:monospace}' +
      '.badge{padding:4px 8px;border-radius:4px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);font-size:9.5px;color:rgba(255,255,255,.3);font-family:monospace}' +
      '.rfb{padding:5px 8px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid rgba(0,176,255,.25);background:rgba(0,176,255,.08);color:#00B0FF;font-family:inherit;margin-left:6px}' +
      '.sa{padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}' +
      '.sb{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:0 10px}' +
      '.sb:focus-within{border-color:rgba(0,176,255,.3)}' +
      '.si{color:rgba(255,255,255,.25);font-size:13px;flex-shrink:0}' +
      '.sin{flex:1;background:none;border:none;outline:none;color:#E0E0E0;font-size:12px;padding:8px 0;font-family:inherit}' +
      '.sin::placeholder{color:rgba(255,255,255,.18)}' +
      '.sc{background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;font-size:12px;padding:2px 4px;display:none}.sc.show{display:inline}' +
      '.fl{display:flex;gap:4px;margin-top:8px;flex-wrap:wrap}' +
      '.fb{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.06);background:transparent;color:rgba(255,255,255,.35);font-family:inherit}' +
      '.fb.ab{border-color:rgba(0,176,255,.3);background:rgba(0,176,255,.08);color:#00B0FF}' +
      '.fb.ap{border-color:rgba(124,77,255,.3);background:rgba(124,77,255,.08);color:#7C4DFF}' +
      '.fs{width:1px;background:rgba(255,255,255,.06);margin:0 3px}' +
      '.mn{display:flex;flex:1;overflow:hidden}' +
      '.rl{flex:1;overflow-y:auto}.rl::-webkit-scrollbar{width:4px}.rl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}' +
      '.ec{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;border-left:3px solid transparent;transition:background .12s}' +
      '.ec:hover{background:rgba(255,255,255,.02)}.ec.sel{background:rgba(0,176,255,.05);border-left-color:#00B0FF}' +
      '.cr{display:flex;align-items:flex-start;gap:8px}.cb{flex:1;min-width:0}' +
      '.csr{display:flex;align-items:center;gap:5px;margin-bottom:3px}' +
      '.csub{font-size:12px;font-weight:600;color:#E0E0E0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
      '.cm{display:flex;align-items:center;gap:6px;margin-bottom:3px}' +
      '.cmt{font-size:10.5px;color:rgba(255,255,255,.4);font-family:monospace}' +
      '.cdot{font-size:8px;color:rgba(255,255,255,.12)}' +
      '.crt{text-align:right;flex-shrink:0}' +
      '.ctm{font-size:9.5px;color:rgba(255,255,255,.3);font-family:monospace;margin-bottom:4px}' +
      '.cstrow{display:flex;gap:3px;justify-content:flex-end;align-items:center}' +
      '.stb{font-size:8.5px;padding:2px 5px;border-radius:3px;font-weight:600;font-family:monospace;text-transform:uppercase;letter-spacing:.3px}' +
      '.st-a{background:rgba(0,200,83,.1);color:#00C853}.st-e{background:rgba(255,255,255,.03);color:rgba(255,255,255,.28)}' +
      '.pd{width:5px;height:5px;border-radius:50%;display:inline-block}' +
      '.ai{font-size:9px;opacity:.35}' +
      'mark{background:#FFAB0033;color:#FFAB00;border-radius:2px;padding:0 1px}' +
      '.dp{width:300px;flex-shrink:0;overflow:hidden;border-left:1px solid rgba(255,255,255,.06);display:none;flex-direction:column;background:#0A0B10}' +
      '.dp.open{display:flex}' +
      '.dh{padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:flex-start}' +
      '.dsub{font-size:12px;font-weight:700;line-height:1.4;flex:1;margin-right:8px}' +
      '.dtid{font-size:9.5px;color:rgba(255,255,255,.35);font-family:monospace;margin-top:3px}' +
      '.xb{background:rgba(255,255,255,.04);border:none;color:rgba(255,255,255,.3);width:24px;height:24px;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
      '.dc{flex:1;overflow-y:auto;padding:14px}.dc::-webkit-scrollbar{width:4px}.dc::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}' +
      '.dr{display:flex;justify-content:space-between;align-items:center;padding:4px 0}' +
      '.dl{font-size:9px;font-weight:700;color:rgba(255,255,255,.2);text-transform:uppercase;letter-spacing:.7px;font-family:monospace}' +
      '.dv{font-size:11px;color:rgba(255,255,255,.6);font-family:monospace;text-align:right;max-width:60%;word-break:break-all}' +
      '.df{padding:8px 14px;border-top:1px solid rgba(255,255,255,.05);font-size:8.5px;color:rgba(255,255,255,.12);font-family:monospace}' +
      '.msg{padding:24px 14px;text-align:center;font-size:12px;color:rgba(255,255,255,.25)}' +
      '.msg-i{font-size:24px;margin-bottom:8px;opacity:.25}' +
      '.msg-h{font-size:10.5px;color:rgba(255,255,255,.13);margin-top:4px}' +
      '.err{color:#FF5252}' +
      '</style>' +

      '<div class="root">' +
        '<div class="hdr">' +
          '<div class="hdr-l">' +
            '<div class="hdr-ico">\u2709</div>' +
            '<div><div class="hdr-t">Email Search</div><div class="hdr-s">Live \u2022 WxCC Search API</div></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center">' +
            '<div class="badge" id="badge">—</div>' +
            '<button class="rfb" id="rfbtn">\u21BB Refresh</button>' +
          '</div>' +
        '</div>' +

        '<div class="sa">' +
          '<div class="sb">' +
            '<span class="si">\u2315</span>' +
            '<input class="sin" id="sinput" type="text" placeholder="Search subject, sender, agent, wrap-up code..." />' +
            '<button class="sc" id="clr">\u2715</button>' +
          '</div>' +
          '<div class="fl" id="dflt">' +
            '<button class="fb ab" data-d="">All</button>' +
            '<button class="fb" data-d="INBOUND">Inbound</button>' +
            '<button class="fb" data-d="OUTBOUND">Outbound</button>' +
            '<span class="fs"></span>' +
          '</div>' +
          '<div class="fl" id="qflt" style="margin-top:4px"></div>' +
        '</div>' +

        '<div class="mn">' +
          '<div class="rl" id="rlist"></div>' +
          '<div class="dp" id="dpnl">' +
            '<div class="dh">' +
              '<div><div class="dsub" id="dps"></div><div class="dtid" id="dpt"></div></div>' +
              '<button class="xb" id="dpc">\u2715</button>' +
            '</div>' +
            '<div class="dc" id="dpcnt"></div>' +
            '<div class="df">Source: WxCC Search API (GraphQL)</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Persistent refs
    var $ = function(id) { return self.shadowRoot.getElementById(id); };
    this._$i = $('sinput');
    this._$c = $('clr');
    this._$b = $('badge');
    this._$rf = $('rfbtn');
    this._$df = $('dflt');
    this._$qf = $('qflt');
    this._$r = $('rlist');
    this._$dp = $('dpnl');
    this._$ds = $('dps');
    this._$dt2 = $('dpt');
    this._$dc = $('dpcnt');
    this._$dpc = $('dpc');

    // Events — bound ONCE
    this._$i.addEventListener('input', function() {
      self._q = self._$i.value;
      self._$c.classList.toggle('show', self._q.length > 0);
      clearTimeout(self._dt);
      self._dt = setTimeout(function() { self._upd(); }, 120);
    });

    this._$c.addEventListener('click', function() {
      self._q = ''; self._$i.value = ''; self._$c.classList.remove('show');
      self._upd(); self._$i.focus();
    });

    this._$rf.addEventListener('click', function() { self._fetch(); });

    this._$df.addEventListener('click', function(e) {
      var b = e.target.closest('[data-d]'); if (!b) return;
      self._df = b.dataset.d;
      self._$df.querySelectorAll('.fb').forEach(function(x) { x.classList.toggle('ab', x.dataset.d === self._df); });
      self._upd();
    });

    this._$qf.addEventListener('click', function(e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      self._qf = b.dataset.q;
      self._$qf.querySelectorAll('.fb').forEach(function(x) { x.classList.toggle('ap', x.dataset.q === self._qf); });
      self._upd();
    });

    this._$r.addEventListener('click', function(e) {
      var c = e.target.closest('[data-t]'); if (!c) return;
      self._sel = self._sel === c.dataset.t ? null : c.dataset.t;
      self._upd();
    });

    this._$dpc.addEventListener('click', function() { self._sel = null; self._upd(); });
  }

  // ═══════════════════════════════════════
  //  Update dynamic content only
  // ═══════════════════════════════════════

  _upd() {
    var self = this;
    var f = this._filt();
    var sel = null;
    for (var i = 0; i < f.length; i++) { if (f[i].id === this._sel) { sel = f[i]; break; } }

    this._$b.textContent = this._loading ? 'Loading...' : f.length + ' email' + (f.length !== 1 ? 's' : '');

    // Queue filter buttons
    var qs = this._queues();
    this._$qf.innerHTML =
      '<button class="fb ' + (this._qf === '' ? 'ap' : '') + '" data-q="">All Queues</button>' +
      qs.map(function(n) {
        return '<button class="fb ' + (self._qf === n ? 'ap' : '') + '" data-q="' + self._esc(n) + '">' + self._esc(n.replace('_Q', '')) + '</button>';
      }).join('');

    // Results
    var q = this._q;
    if (this._loading) {
      this._$r.innerHTML = '<div class="msg"><div class="msg-i">\u23F3</div>Querying WxCC Search API...<div class="msg-h">Fetching email tasks from the last 30 days</div></div>';
    } else if (this._err && f.length === 0) {
      this._$r.innerHTML = '<div class="msg"><div class="msg-i">\u26A0</div><div class="err">' + this._esc(this._err) + '</div><div class="msg-h">Check the browser console for details</div></div>';
    } else if (f.length === 0) {
      this._$r.innerHTML = '<div class="msg"><div class="msg-i">\u2709</div>No email conversations match<div class="msg-h">Try adjusting your query or filters</div></div>';
    } else {
      this._$r.innerHTML = f.map(function(e) {
        return '<div class="ec' + (self._sel === e.id ? ' sel' : '') + '" data-t="' + self._esc(e.id) + '">' +
          '<div class="cr"><div class="cb">' +
            '<div class="csr">' +
              '<span style="font-size:10px">' + (e.dir === 'INBOUND' ? '\uD83D\uDCE9' : '\uD83D\uDCE4') + '</span>' +
              '<div class="csub">' + self._hl(e.sub, q) + '</div>' +
              (e.att ? '<span class="ai">\uD83D\uDCCE</span>' : '') +
            '</div>' +
            '<div class="cm">' +
              '<span class="cmt">' + self._hl(e.from, q) + '</span>' +
              '<span class="cdot">\u2022</span>' +
              '<span class="cmt">' + self._esc(e.queue) + '</span>' +
              '<span class="cdot">\u2022</span>' +
              '<span class="cmt">' + self._hl(e.agent, q) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="crt">' +
            '<div class="ctm">' + self._ft(e.ct) + '</div>' +
            '<div class="cstrow">' +
              '<span class="stb ' + (e.st === 'active' ? 'st-a' : 'st-e') + '">' + self._esc(e.st) + '</span>' +
              '<span class="pd" style="background:' + self._pc(e.pr) + (e.pr <= 2 ? ';box-shadow:0 0 4px ' + self._pc(e.pr) : '') + '"></span>' +
            '</div>' +
            (e.wrap ? '<div class="cmt" style="margin-top:3px;font-size:9px">' + self._hl(e.wrap, q) + '</div>' : '') +
          '</div></div></div>';
      }).join('');
    }

    // Detail panel
    if (sel) {
      this._$dp.classList.add('open');
      this._$ds.textContent = sel.sub;
      this._$dt2.textContent = sel.id;
      this._$dc.innerHTML = [
        ['Direction', sel.dir],
        ['From', sel.from],
        ['To', sel.to],
        ['CC', sel.cc || '\u2014'],
        ['Queue', sel.queue],
        ['Agent', sel.agent],
        ['Wrap-Up', sel.wrap || '\u2014'],
        ['Priority', 'P' + sel.pr],
        ['Created', this._ft(sel.ct)],
        ['Ended', this._ft(sel.et)],
        ['Duration', this._fd(sel.ct, sel.et)],
        ['Attachments', sel.att ? 'Yes' : 'No'],
        ['Status', (sel.st || '').toUpperCase()]
      ].map(function(r) {
        return '<div class="dr"><span class="dl">' + r[0] + '</span><span class="dv">' + self._esc(r[1]) + '</span></div>';
      }).join('');
    } else {
      this._$dp.classList.remove('open');
    }
  }
}

customElements.define('email-search-widget', EmailSearchWidget);
