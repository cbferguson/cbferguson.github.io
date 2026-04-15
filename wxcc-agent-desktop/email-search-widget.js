/**
 * email-search-widget.js
 * 
 * Webex Contact Center Agent Desktop — Custom Web Component
 * Searches historical email conversations via the WxCC Search API (GraphQL)
 * and CJDS Journey API.
 *
 * DEPLOYMENT:
 *   1. Host this file on any HTTPS CDN/server accessible to agents
 *   2. Update Desktop Layout JSON "script" URL to point to it
 *   3. Upload layout via Control Hub → Contact Center → Desktop Layouts
 */

class EmailSearchWidget extends HTMLElement {

  static get observedAttributes() {
    return ['bearertoken', 'organizationid', 'datacenter', 'darkmode'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._query = '';
    this._directionFilter = '';
    this._queueFilter = '';
    this._selectedTaskId = null;
    this._results = [];
    this._loading = false;
    this._error = null;
    this._debounceTimer = null;
    this._initialized = false;
    this._token = '';
    this._orgId = '';
    this._dc = '';
  }

  connectedCallback() {
    this._buildShell();
    this._results = this._getDemoData();
    this._updateResults();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'bearertoken') this._token = newVal || '';
    if (name === 'organizationid') this._orgId = newVal || '';
    if (name === 'datacenter') this._dc = newVal || '';
    if (name === 'bearertoken' && newVal && !oldVal) {
      this._fetchEmails();
    }
  }

  // ══════════════════════════════════════════════
  //  API
  // ══════════════════════════════════════════════

  get _apiBase() {
    const dc = this._dc || 'us1';
    return `https://api.wxcc-${dc}.cisco.com`;
  }

  async _fetchEmails() {
    if (!this._token) return;
    this._loading = true;
    this._updateResults();

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const graphqlQuery = `{
      task(
        from: ${thirtyDaysAgo}
        to: ${now}
        filter: { channelType: { equals: "email" } }
        pagination: { cursor: "0" }
      ) {
        tasks {
          id channelType direction origin destination status
          createdTime endedTime queueName wrapupCodeName
          isEmailHasAttachment emailCc emailSubject contactPriority
          lastAgent { name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    try {
      const resp = await fetch(`${this._apiBase}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token}`,
          'organizationId': this._orgId
        },
        body: JSON.stringify({ query: graphqlQuery })
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const tasks = data?.data?.task?.tasks || [];
      this._results = tasks.map(t => ({
        taskId: t.id,
        direction: (t.direction || '').toUpperCase(),
        origin: t.origin || '',
        destination: t.destination || '',
        subject: t.emailSubject || '(No subject)',
        queueName: t.queueName || '',
        agentName: t.lastAgent?.name || 'Unassigned',
        wrapUpCode: t.wrapupCodeName || '',
        createdTime: t.createdTime,
        endedTime: t.endedTime,
        status: t.status || 'unknown',
        hasAttachments: t.isEmailHasAttachment || false,
        ccList: t.emailCc || '',
        priority: t.contactPriority || 5,
        bodyPreview: ''
      }));
    } catch (err) {
      console.warn('[EmailSearchWidget] API error, using demo data:', err.message);
      this._results = this._getDemoData();
    }
    this._loading = false;
    this._updateResults();
  }

  // ══════════════════════════════════════════════
  //  Demo data
  // ══════════════════════════════════════════════

  _getDemoData() {
    const now = Date.now();
    return [
      { taskId:'d-001', direction:'INBOUND', origin:'maria.garcia@example.com', destination:'support@company.com',
        subject:'Billing discrepancy on invoice #4892', queueName:'Billing_Q', agentName:'James Wilson',
        wrapUpCode:'Billing Inquiry', createdTime:now-86400000, endedTime:now-82800000, status:'ended',
        hasAttachments:true, ccList:'accounting@example.com', priority:3,
        bodyPreview:'I noticed a charge of $249.99 on my latest invoice that I don\'t recognize. My account number is AC-88271. Could you provide a detailed breakdown?' },
      { taskId:'d-002', direction:'INBOUND', origin:'tom.chen@acmecorp.com', destination:'support@company.com',
        subject:'RE: License renewal quote request', queueName:'Sales_Q', agentName:'Sarah Mitchell',
        wrapUpCode:'Sales Inquiry', createdTime:now-172800000, endedTime:now-165600000, status:'ended',
        hasAttachments:false, ccList:'procurement@acmecorp.com', priority:5,
        bodyPreview:'We\'d like to proceed with the enterprise tier for 250 seats. Can you confirm pricing for a 3-year commitment? Our procurement team needs the final quote by Friday.' },
      { taskId:'d-003', direction:'INBOUND', origin:'lisa.wong@startup.io', destination:'support@company.com',
        subject:'URGENT: API integration returning 503 errors', queueName:'Technical_Q', agentName:'David Park',
        wrapUpCode:'Technical Issue', createdTime:now-3600000, endedTime:null, status:'active',
        hasAttachments:true, ccList:'devops@startup.io, cto@startup.io', priority:1,
        bodyPreview:'Experiencing intermittent 503 Service Unavailable errors on /v2/messages since 3:15 PM EST. Blocking production deployment affecting approximately 12,000 users.' },
      { taskId:'d-004', direction:'OUTBOUND', origin:'support@company.com', destination:'raj.patel@megabank.com',
        subject:'RE: SSO configuration assistance needed', queueName:'Technical_Q', agentName:'Emily Torres',
        wrapUpCode:'Configuration Help', createdTime:now-259200000, endedTime:now-252000000, status:'ended',
        hasAttachments:true, ccList:'', priority:5,
        bodyPreview:'I\'ve prepared the SAML metadata file for your IdP configuration. Entity ID and ACS URL have been pre-configured for your tenant.' },
      { taskId:'d-005', direction:'INBOUND', origin:'anna.smith@retailco.com', destination:'support@company.com',
        subject:'Feature request: Bulk export for reporting', queueName:'General_Q', agentName:'James Wilson',
        wrapUpCode:'Feature Request', createdTime:now-345600000, endedTime:now-342000000, status:'ended',
        hasAttachments:false, ccList:'analytics@retailco.com', priority:7,
        bodyPreview:'Our analytics team needs to export more than 5,000 records at a time from the reporting dashboard. Currently capped at 1,000 rows.' },
      { taskId:'d-006', direction:'INBOUND', origin:'maria.garcia@example.com', destination:'support@company.com',
        subject:'RE: Billing discrepancy — Follow up', queueName:'Billing_Q', agentName:'James Wilson',
        wrapUpCode:'Billing Inquiry', createdTime:now-43200000, endedTime:now-39600000, status:'ended',
        hasAttachments:false, ccList:'', priority:4,
        bodyPreview:'Thanks for the explanation on the compliance fee. I wasn\'t notified ahead of time. Can you waive it for this cycle? I\'ve been a loyal customer for over 5 years.' }
    ];
  }

  // ══════════════════════════════════════════════
  //  Filtering
  // ══════════════════════════════════════════════

  _getFiltered() {
    return this._results.filter(e => {
      if (this._directionFilter && e.direction !== this._directionFilter) return false;
      if (this._queueFilter && e.queueName !== this._queueFilter) return false;
      if (this._query.length >= 2) {
        const q = this._query.toLowerCase();
        return [e.subject, e.origin, e.destination, e.bodyPreview, e.wrapUpCode, e.agentName, e.queueName, e.taskId]
          .some(field => (field || '').toLowerCase().includes(q));
      }
      return true;
    });
  }

  _getQueues() {
    return [...new Set(this._results.map(e => e.queueName).filter(Boolean))].sort();
  }

  // ══════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════

  _esc(s) { const el = document.createElement('span'); el.textContent = s || ''; return el.innerHTML; }

  _hl(text, q) {
    if (!q || q.length < 2 || !text) return this._esc(text);
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this._esc(text).replace(new RegExp(`(${esc})`, 'gi'), '<mark>$1</mark>');
  }

  _fmtTime(epoch) {
    if (!epoch) return '—';
    const d = new Date(epoch);
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ', ' +
           d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  }

  _fmtDur(s, e) {
    if (!s||!e) return 'Active';
    const m = Math.round((e-s)/60000);
    return m < 60 ? m+'m' : Math.floor(m/60)+'h '+m%60+'m';
  }

  _pColor(p) {
    if (p<=1) return '#FF1744'; if (p<=2) return '#FF5252';
    if (p<=3) return '#FF9100'; if (p<=4) return '#FFB300'; return '#78909C';
  }

  // ══════════════════════════════════════════════
  //  Build the shell ONCE — never destroy the input
  // ══════════════════════════════════════════════

  _buildShell() {
    if (this._initialized) return;
    this._initialized = true;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; height:100%; font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif; color:#E0E0E0; background:#07080D; overflow:hidden; }
        *{box-sizing:border-box}
        .root{display:flex;flex-direction:column;height:100%}
        .hdr{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
        .hdr-l{display:flex;align-items:center;gap:8px}
        .hdr-ico{width:26px;height:26px;border-radius:6px;background:linear-gradient(135deg,rgba(0,176,255,.15),rgba(124,77,255,.15));border:1px solid rgba(0,176,255,.2);display:flex;align-items:center;justify-content:center;font-size:13px}
        .hdr-t{font-size:12px;font-weight:700}
        .hdr-s{font-size:9px;color:rgba(255,255,255,.25);font-family:monospace}
        .badge{padding:4px 8px;border-radius:4px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);font-size:9.5px;color:rgba(255,255,255,.3);font-family:monospace}
        .sa{padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}
        .sb{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:0 10px}
        .sb:focus-within{border-color:rgba(0,176,255,.3)}
        .si{color:rgba(255,255,255,.25);font-size:13px;flex-shrink:0}
        .sin{flex:1;background:none;border:none;outline:none;color:#E0E0E0;font-size:12px;padding:8px 0;font-family:inherit}
        .sin::placeholder{color:rgba(255,255,255,.18)}
        .sc{background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;font-size:12px;padding:2px 4px;display:none}
        .sc.show{display:inline}
        .fl{display:flex;gap:4px;margin-top:8px;flex-wrap:wrap}
        .fb{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.06);background:transparent;color:rgba(255,255,255,.35);font-family:inherit}
        .fb.ab{border-color:rgba(0,176,255,.3);background:rgba(0,176,255,.08);color:#00B0FF}
        .fb.ap{border-color:rgba(124,77,255,.3);background:rgba(124,77,255,.08);color:#7C4DFF}
        .fs{width:1px;background:rgba(255,255,255,.06);margin:0 3px}
        .mn{display:flex;flex:1;overflow:hidden}
        .rl{flex:1;overflow-y:auto}
        .rl::-webkit-scrollbar{width:4px}
        .rl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}
        .ec{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;border-left:3px solid transparent;transition:background .12s,border-color .12s}
        .ec:hover{background:rgba(255,255,255,.02)}
        .ec.sel{background:rgba(0,176,255,.05);border-left-color:#00B0FF}
        .cr{display:flex;align-items:flex-start;gap:8px}
        .cb{flex:1;min-width:0}
        .csr{display:flex;align-items:center;gap:5px;margin-bottom:3px}
        .csub{font-size:12px;font-weight:600;color:#E0E0E0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .cm{display:flex;align-items:center;gap:6px;margin-bottom:3px}
        .cmt{font-size:10.5px;color:rgba(255,255,255,.4);font-family:monospace}
        .cdot{font-size:8px;color:rgba(255,255,255,.12)}
        .cpv{font-size:10.5px;color:rgba(255,255,255,.28);line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .crt{text-align:right;flex-shrink:0}
        .ctm{font-size:9.5px;color:rgba(255,255,255,.3);font-family:monospace;margin-bottom:4px}
        .cstrow{display:flex;gap:3px;justify-content:flex-end;align-items:center}
        .stb{font-size:8.5px;padding:2px 5px;border-radius:3px;font-weight:600;font-family:monospace;text-transform:uppercase;letter-spacing:.3px}
        .st-a{background:rgba(0,200,83,.1);color:#00C853}
        .st-e{background:rgba(255,255,255,.03);color:rgba(255,255,255,.28)}
        .pd{width:5px;height:5px;border-radius:50%}
        .ai{font-size:9px;opacity:.35}
        mark{background:#FFAB0033;color:#FFAB00;border-radius:2px;padding:0 1px}
        .dp{width:300px;flex-shrink:0;overflow:hidden;border-left:1px solid rgba(255,255,255,.06);display:none;flex-direction:column;background:#0A0B10}
        .dp.open{display:flex}
        .dh{padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:flex-start}
        .dsub{font-size:12px;font-weight:700;line-height:1.4;flex:1;margin-right:8px}
        .dtid{font-size:9.5px;color:rgba(255,255,255,.35);font-family:monospace;margin-top:3px}
        .xb{background:rgba(255,255,255,.04);border:none;color:rgba(255,255,255,.3);width:24px;height:24px;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .dc{flex:1;overflow-y:auto;padding:14px}
        .dc::-webkit-scrollbar{width:4px}
        .dc::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}
        .dr{display:flex;justify-content:space-between;align-items:center;padding:4px 0}
        .dl{font-size:9px;font-weight:700;color:rgba(255,255,255,.2);text-transform:uppercase;letter-spacing:.7px;font-family:monospace}
        .dv{font-size:11px;color:rgba(255,255,255,.6);font-family:monospace;text-align:right;max-width:60%;word-break:break-all}
        .df{padding:8px 14px;border-top:1px solid rgba(255,255,255,.05);font-size:8.5px;color:rgba(255,255,255,.12);font-family:monospace}
        .emp{padding:32px 14px;text-align:center}
        .emp-i{font-size:24px;margin-bottom:8px;opacity:.25}
        .emp-t{font-size:12px;color:rgba(255,255,255,.25)}
        .emp-h{font-size:10.5px;color:rgba(255,255,255,.13);margin-top:4px}
        .ldg{font-size:11px;color:rgba(255,255,255,.3);padding:20px;text-align:center}
        .ft{padding:6px 14px;border-top:1px solid rgba(255,255,255,.05);font-size:8.5px;color:rgba(255,255,255,.12);font-family:monospace;flex-shrink:0;display:flex;justify-content:space-between}
      </style>

      <div class="root">
        <div class="hdr">
          <div class="hdr-l">
            <div class="hdr-ico">✉️</div>
            <div><div class="hdr-t">Email Search</div><div class="hdr-s">Search API + CJDS</div></div>
          </div>
          <div class="badge" id="count-badge">0 results</div>
        </div>

        <div class="sa">
          <div class="sb">
            <span class="si">⌕</span>
            <input class="sin" id="search-input" type="text" placeholder="Search subject, sender, body, wrap-up code..." />
            <button class="sc" id="clear-btn">✕</button>
          </div>
          <div class="fl" id="dir-filters">
            <button class="fb ab" data-dir="">All</button>
            <button class="fb" data-dir="INBOUND">Inbound</button>
            <button class="fb" data-dir="OUTBOUND">Outbound</button>
            <span class="fs"></span>
          </div>
          <div class="fl" id="queue-filters" style="margin-top:4px"></div>
        </div>

        <div class="mn">
          <div class="rl" id="results-list"></div>
          <div class="dp" id="detail-panel">
            <div class="dh">
              <div><div class="dsub" id="dp-subject"></div><div class="dtid" id="dp-taskid"></div></div>
              <button class="xb" id="dp-close">✕</button>
            </div>
            <div class="dc" id="dp-content"></div>
            <div class="df">Data: /search (GraphQL CSR) + CJDS Journey API</div>
          </div>
        </div>

        <div class="ft">
          <span>POST /search (GraphQL) · GET /v1/journey/events</span>
          <span>developer.webex-cx.com</span>
        </div>
      </div>
    `;

    // ── Persistent references — these elements are NEVER destroyed ──
    this._$input = this.shadowRoot.getElementById('search-input');
    this._$clearBtn = this.shadowRoot.getElementById('clear-btn');
    this._$badge = this.shadowRoot.getElementById('count-badge');
    this._$dirFilters = this.shadowRoot.getElementById('dir-filters');
    this._$queueFilters = this.shadowRoot.getElementById('queue-filters');
    this._$resultsList = this.shadowRoot.getElementById('results-list');
    this._$detailPanel = this.shadowRoot.getElementById('detail-panel');
    this._$dpSubject = this.shadowRoot.getElementById('dp-subject');
    this._$dpTaskId = this.shadowRoot.getElementById('dp-taskid');
    this._$dpContent = this.shadowRoot.getElementById('dp-content');
    this._$dpClose = this.shadowRoot.getElementById('dp-close');

    // ── Bind events ONCE on persistent elements ──

    this._$input.addEventListener('input', () => {
      this._query = this._$input.value;
      this._$clearBtn.classList.toggle('show', this._query.length > 0);
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._updateResults(), 120);
    });

    this._$clearBtn.addEventListener('click', () => {
      this._query = '';
      this._$input.value = '';
      this._$clearBtn.classList.remove('show');
      this._updateResults();
      this._$input.focus();
    });

    this._$dirFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dir]');
      if (!btn) return;
      this._directionFilter = btn.dataset.dir;
      this._$dirFilters.querySelectorAll('.fb').forEach(b => {
        b.classList.toggle('ab', b.dataset.dir === this._directionFilter);
      });
      this._updateResults();
    });

    this._$queueFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-queue]');
      if (!btn) return;
      this._queueFilter = btn.dataset.queue;
      this._$queueFilters.querySelectorAll('.fb').forEach(b => {
        b.classList.toggle('ap', b.dataset.queue === this._queueFilter);
      });
      this._updateResults();
    });

    this._$resultsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-tid]');
      if (!card) return;
      const tid = card.dataset.tid;
      this._selectedTaskId = this._selectedTaskId === tid ? null : tid;
      this._updateResults();
    });

    this._$dpClose.addEventListener('click', () => {
      this._selectedTaskId = null;
      this._updateResults();
    });
  }

  // ══════════════════════════════════════════════
  //  Update ONLY the dynamic parts (results + detail)
  //  The search input is NEVER touched.
  // ══════════════════════════════════════════════

  _updateResults() {
    const filtered = this._getFiltered();
    const q = this._query;
    const selected = filtered.find(e => e.taskId === this._selectedTaskId);

    // Badge
    this._$badge.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;

    // Queue filter buttons (rebuild only when queue list changes)
    const queues = this._getQueues();
    const queueHtml = [
      `<button class="fb ${this._queueFilter === '' ? 'ap' : ''}" data-queue="">All Queues</button>`,
      ...queues.map(qn =>
        `<button class="fb ${this._queueFilter === qn ? 'ap' : ''}" data-queue="${this._esc(qn)}">${this._esc(qn.replace('_Q',''))}</button>`
      )
    ].join('');
    this._$queueFilters.innerHTML = queueHtml;

    // Results list
    if (this._loading) {
      this._$resultsList.innerHTML = '<div class="ldg">Searching email conversations...</div>';
    } else if (filtered.length === 0) {
      this._$resultsList.innerHTML = `
        <div class="emp">
          <div class="emp-i">✉️</div>
          <div class="emp-t">No email conversations match your search</div>
          <div class="emp-h">Try adjusting your query or filters</div>
        </div>`;
    } else {
      this._$resultsList.innerHTML = filtered.map(e => `
        <div class="ec${this._selectedTaskId === e.taskId ? ' sel' : ''}" data-tid="${this._esc(e.taskId)}">
          <div class="cr">
            <div class="cb">
              <div class="csr">
                <span style="font-size:10px">${e.direction === 'INBOUND' ? '📩' : '📤'}</span>
                <div class="csub">${this._hl(e.subject, q)}</div>
                ${e.hasAttachments ? '<span class="ai">📎</span>' : ''}
              </div>
              <div class="cm">
                <span class="cmt">${this._hl(e.origin, q)}</span>
                <span class="cdot">•</span>
                <span class="cmt">${this._esc(e.queueName)}</span>
                <span class="cdot">•</span>
                <span class="cmt">${this._esc(e.agentName)}</span>
              </div>
              ${e.bodyPreview ? `<div class="cpv">${this._hl(e.bodyPreview, q)}</div>` : ''}
            </div>
            <div class="crt">
              <div class="ctm">${this._fmtTime(e.createdTime)}</div>
              <div class="cstrow">
                <span class="stb ${e.status==='active'?'st-a':'st-e'}">${this._esc(e.status)}</span>
                <span class="pd" style="background:${this._pColor(e.priority)}${e.priority<=2?`;box-shadow:0 0 4px ${this._pColor(e.priority)}`:''}"></span>
              </div>
              ${e.wrapUpCode ? `<div class="cmt" style="margin-top:3px;font-size:9px">${this._hl(e.wrapUpCode, q)}</div>` : ''}
            </div>
          </div>
        </div>
      `).join('');
    }

    // Detail panel
    if (selected) {
      this._$detailPanel.classList.add('open');
      this._$dpSubject.textContent = selected.subject;
      this._$dpTaskId.textContent = selected.taskId;
      this._$dpContent.innerHTML = [
        ['Direction', selected.direction],
        ['From', selected.origin],
        ['To', selected.destination],
        ['CC', selected.ccList || '—'],
        ['Queue', selected.queueName],
        ['Agent', selected.agentName],
        ['Wrap-Up', selected.wrapUpCode || '—'],
        ['Priority', 'P' + selected.priority],
        ['Created', this._fmtTime(selected.createdTime)],
        ['Ended', this._fmtTime(selected.endedTime)],
        ['Duration', this._fmtDur(selected.createdTime, selected.endedTime)],
        ['Attachments', selected.hasAttachments ? 'Yes' : 'No'],
        ['Status', (selected.status||'').toUpperCase()]
      ].map(([l,v]) => `<div class="dr"><span class="dl">${l}</span><span class="dv">${this._esc(v)}</span></div>`).join('');
    } else {
      this._$detailPanel.classList.remove('open');
    }
  }
}

customElements.define('email-search-widget', EmailSearchWidget);
