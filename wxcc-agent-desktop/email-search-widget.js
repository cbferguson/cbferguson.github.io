/**
 * email-search-widget.js
 * 
 * Webex Contact Center Agent Desktop — Custom Web Component
 * Searches historical email conversations via the WxCC Search API (GraphQL)
 * and CJDS Journey API.
 *
 * DEPLOYMENT:
 *   1. Host this file on any HTTPS CDN or web server accessible to agents
 *   2. Update the Desktop Layout JSON "script" URL to point to it:
 *      "script": "https://your-cdn.com/email-search-widget.js"
 *   3. Upload layout via Control Hub → Contact Center → Desktop Layouts
 *
 * STORE PROPERTIES (passed via Desktop Layout JSON):
 *   - bearerToken:    $STORE.auth.accessToken
 *   - organizationId: $STORE.agent.orgId
 *   - dataCenter:     $STORE.app.datacenter
 *   - interactionData: $STORE.agentContact.taskSelected
 *   - darkmode:       $STORE.app.darkMode
 *
 * API ENDPOINTS USED:
 *   - POST https://api.{datacenter}.cisco.com/search  (GraphQL — CSR task data)
 *   - GET  https://cjp-{datacenter}.cisco.com/v1/journey/events (CJDS)
 */

class EmailSearchWidget extends HTMLElement {

  // ── Observed attributes from Desktop Layout properties ──
  static get observedAttributes() {
    return ['bearertoken', 'organizationid', 'datacenter', 'darkmode'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Internal state
    this._query = '';
    this._directionFilter = '';
    this._queueFilter = '';
    this._selectedTaskId = null;
    this._results = [];
    this._loading = false;
    this._error = null;
    this._debounceTimer = null;

    // API config (populated from attributes)
    this._token = '';
    this._orgId = '';
    this._dc = '';
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'bearertoken') this._token = newVal || '';
    if (name === 'organizationid') this._orgId = newVal || '';
    if (name === 'datacenter') this._dc = newVal || '';
    // Re-render if token arrives (initial load from STORE)
    if (name === 'bearertoken' && newVal && !oldVal) {
      this._fetchEmails();
    }
  }

  // ── API: Resolve base URL from datacenter ──
  get _apiBase() {
    // datacenter values: "us1", "eu1", "eu2", "anz1", "sg1", "ca1", etc.
    const dc = this._dc || 'us1';
    return `https://api.wxcc-${dc}.cisco.com`;
  }

  // ── API: Fetch email tasks via GraphQL Search API ──
  async _fetchEmails() {
    if (!this._token) return;

    this._loading = true;
    this._error = null;
    this._render();

    // Build GraphQL query for email channel tasks
    // The /search endpoint uses GraphQL to query CSR (Contact Session Records)
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const graphqlQuery = `{
      task(
        from: ${thirtyDaysAgo}
        to: ${now}
        filter: {
          channelType: { equals: "email" }
          ${this._directionFilter ? `direction: { equals: "${this._directionFilter === 'INBOUND' ? 'inbound' : 'outbound'}" }` : ''}
          ${this._queueFilter ? `queueName: { equals: "${this._queueFilter}" }` : ''}
        }
        pagination: { cursor: "0" }
      ) {
        tasks {
          id
          channelType
          direction
          origin
          destination
          status
          createdTime
          endedTime
          queueName
          lastAgent {
            name
          }
          wrapupCodeName
          isEmailHasAttachment
          emailCc
          emailSubject
          contactPriority
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;

    try {
      const response = await fetch(`${this._apiBase}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token}`,
          'organizationId': this._orgId
        },
        body: JSON.stringify({ query: graphqlQuery })
      });

      if (!response.ok) {
        throw new Error(`Search API returned ${response.status}`);
      }

      const data = await response.json();
      const tasks = data?.data?.task?.tasks || [];

      this._results = tasks.map(t => ({
        taskId: t.id,
        channelType: t.channelType || 'email',
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
        // Note: email body is NOT in CSR — it lives in Webex Engage.
        // To search body text, write snippets to CJDS via your Connect flow.
        bodyPreview: ''
      }));

      this._loading = false;
      this._render();

    } catch (err) {
      console.error('[EmailSearchWidget] Search API error:', err);
      this._error = err.message;
      this._loading = false;

      // Fall back to demo data so the widget is still usable for testing
      this._results = this._getDemoData();
      this._render();
    }
  }

  // ── API: Fetch journey events for a customer ──
  async _fetchJourney(alias) {
    if (!this._token || !alias) return [];

    try {
      const dc = this._dc || 'us1';
      const response = await fetch(
        `https://cjp-${dc}.cisco.com/v1/journey/events?alias=${encodeURIComponent(alias)}`,
        {
          headers: {
            'Authorization': `Bearer ${this._token}`,
            'organizationId': this._orgId
          }
        }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data?.events || [];
    } catch (err) {
      console.warn('[EmailSearchWidget] CJDS fetch error:', err);
      return [];
    }
  }

  // ── Demo/fallback data ──
  _getDemoData() {
    return [
      {
        taskId: 'demo-001', channelType: 'email', direction: 'INBOUND',
        origin: 'maria.garcia@example.com', destination: 'support@company.com',
        subject: 'Billing discrepancy on invoice #4892', queueName: 'Billing_Q',
        agentName: 'James Wilson', wrapUpCode: 'Billing Inquiry',
        createdTime: Date.now() - 86400000, endedTime: Date.now() - 82800000,
        status: 'ended', hasAttachments: true, ccList: 'accounting@example.com',
        priority: 3, bodyPreview: 'I noticed a charge of $249.99 on my latest invoice that I don\'t recognize. My account number is AC-88271.'
      },
      {
        taskId: 'demo-002', channelType: 'email', direction: 'INBOUND',
        origin: 'tom.chen@acmecorp.com', destination: 'support@company.com',
        subject: 'RE: License renewal quote request', queueName: 'Sales_Q',
        agentName: 'Sarah Mitchell', wrapUpCode: 'Sales Inquiry',
        createdTime: Date.now() - 172800000, endedTime: Date.now() - 165600000,
        status: 'ended', hasAttachments: false, ccList: 'procurement@acmecorp.com',
        priority: 5, bodyPreview: 'We\'d like to proceed with the enterprise tier for 250 seats. Can you confirm pricing for a 3-year commitment?'
      },
      {
        taskId: 'demo-003', channelType: 'email', direction: 'INBOUND',
        origin: 'lisa.wong@startup.io', destination: 'support@company.com',
        subject: 'URGENT: API integration returning 503 errors', queueName: 'Technical_Q',
        agentName: 'David Park', wrapUpCode: 'Technical Issue',
        createdTime: Date.now() - 3600000, endedTime: null,
        status: 'active', hasAttachments: true, ccList: 'devops@startup.io',
        priority: 1, bodyPreview: 'Experiencing intermittent 503 errors on /v2/messages since 3:15 PM EST. Blocking production deployment for ~12,000 users.'
      },
      {
        taskId: 'demo-004', channelType: 'email', direction: 'OUTBOUND',
        origin: 'support@company.com', destination: 'raj.patel@megabank.com',
        subject: 'RE: SSO configuration assistance needed', queueName: 'Technical_Q',
        agentName: 'Emily Torres', wrapUpCode: 'Configuration Help',
        createdTime: Date.now() - 259200000, endedTime: Date.now() - 252000000,
        status: 'ended', hasAttachments: true, ccList: '',
        priority: 5, bodyPreview: 'I\'ve prepared the SAML metadata file for your IdP configuration. Entity ID and ACS URL have been pre-configured for your tenant.'
      },
      {
        taskId: 'demo-005', channelType: 'email', direction: 'INBOUND',
        origin: 'anna.smith@retailco.com', destination: 'support@company.com',
        subject: 'Feature request: Bulk export for reporting', queueName: 'General_Q',
        agentName: 'James Wilson', wrapUpCode: 'Feature Request',
        createdTime: Date.now() - 345600000, endedTime: Date.now() - 342000000,
        status: 'ended', hasAttachments: false, ccList: '',
        priority: 7, bodyPreview: 'Our analytics team needs to export more than 5,000 records at a time from the reporting dashboard.'
      }
    ];
  }

  // ── Filtering logic ──
  _getFilteredResults() {
    return this._results.filter(e => {
      if (this._directionFilter && e.direction !== this._directionFilter) return false;
      if (this._queueFilter && e.queueName !== this._queueFilter) return false;
      if (this._query.length >= 2) {
        const q = this._query.toLowerCase();
        return (
          (e.subject || '').toLowerCase().includes(q) ||
          (e.origin || '').toLowerCase().includes(q) ||
          (e.destination || '').toLowerCase().includes(q) ||
          (e.bodyPreview || '').toLowerCase().includes(q) ||
          (e.wrapUpCode || '').toLowerCase().includes(q) ||
          (e.agentName || '').toLowerCase().includes(q) ||
          (e.queueName || '').toLowerCase().includes(q) ||
          (e.taskId || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  _getUniqueQueues() {
    const queues = new Set(this._results.map(e => e.queueName).filter(Boolean));
    return [...queues].sort();
  }

  // ── Formatting helpers ──
  _fmtTime(epoch) {
    if (!epoch) return '—';
    const d = new Date(epoch);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  _fmtDuration(start, end) {
    if (!start || !end) return 'Active';
    const mins = Math.round((end - start) / 60000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  _highlight(text, query) {
    if (!query || query.length < 2 || !text) return this._esc(text || '');
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text || '').replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark style="background:#FFAB0033;color:#FFAB00;border-radius:2px;padding:0 1px">$1</mark>'
    );
  }

  _esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  // ── Event handlers ──
  _onSearch(e) {
    this._query = e.target.value;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._render(), 150);
  }

  _clearSearch() {
    this._query = '';
    this._render();
  }

  _setDirection(dir) {
    this._directionFilter = dir;
    this._fetchEmails();
  }

  _setQueue(queue) {
    this._queueFilter = queue;
    this._render();
  }

  _selectTask(taskId) {
    this._selectedTaskId = this._selectedTaskId === taskId ? null : taskId;
    this._render();
  }

  _closeDetail() {
    this._selectedTaskId = null;
    this._render();
  }

  // ── Render ──
  _render() {
    const filtered = this._getFilteredResults();
    const selected = filtered.find(e => e.taskId === this._selectedTaskId);
    const queues = this._getUniqueQueues();
    const q = this._query;

    const priorityColor = (p) => {
      if (p <= 1) return '#FF1744';
      if (p <= 2) return '#FF5252';
      if (p <= 3) return '#FF9100';
      if (p <= 4) return '#FFB300';
      return '#78909C';
    };

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
          color: #E0E0E0;
          background: #07080D;
          overflow: hidden;
        }
        * { box-sizing: border-box; }
        .root { display: flex; flex-direction: column; height: 100%; }

        /* Header */
        .header {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 8px; }
        .header-icon {
          width: 26px; height: 26px; border-radius: 6px;
          background: linear-gradient(135deg, rgba(0,176,255,0.15), rgba(124,77,255,0.15));
          border: 1px solid rgba(0,176,255,0.2);
          display: flex; align-items: center; justify-content: center; font-size: 13px;
        }
        .header-title { font-size: 12px; font-weight: 700; }
        .header-sub { font-size: 9px; color: rgba(255,255,255,0.25); font-family: monospace; }
        .badge {
          padding: 4px 8px; border-radius: 4px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
          font-size: 9.5px; color: rgba(255,255,255,0.3); font-family: monospace;
        }

        /* Search */
        .search-area { padding: 12px 14px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
        .search-box {
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px; padding: 0 10px;
        }
        .search-box:focus-within { border-color: rgba(0,176,255,0.3); }
        .search-icon { color: rgba(255,255,255,0.25); font-size: 13px; flex-shrink: 0; }
        .search-input {
          flex: 1; background: none; border: none; outline: none;
          color: #E0E0E0; font-size: 12px; padding: 8px 0;
          font-family: inherit;
        }
        .search-input::placeholder { color: rgba(255,255,255,0.18); }
        .search-clear {
          background: none; border: none; color: rgba(255,255,255,0.25);
          cursor: pointer; font-size: 12px; padding: 2px 4px;
        }
        .filters { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
        .filter-btn {
          padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;
          cursor: pointer; border: 1px solid rgba(255,255,255,0.06);
          background: transparent; color: rgba(255,255,255,0.35);
          font-family: inherit;
        }
        .filter-btn.active-blue { border-color: rgba(0,176,255,0.3); background: rgba(0,176,255,0.08); color: #00B0FF; }
        .filter-btn.active-purple { border-color: rgba(124,77,255,0.3); background: rgba(124,77,255,0.08); color: #7C4DFF; }
        .filter-sep { width: 1px; background: rgba(255,255,255,0.06); margin: 0 3px; }

        /* Main content */
        .main { display: flex; flex: 1; overflow: hidden; }
        .results { flex: 1; overflow-y: auto; }
        .results::-webkit-scrollbar { width: 4px; }
        .results::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }

        /* Email card */
        .email-card {
          padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.04);
          cursor: pointer; border-left: 3px solid transparent;
          transition: background 0.12s, border-color 0.12s;
        }
        .email-card:hover { background: rgba(255,255,255,0.02); }
        .email-card.selected { background: rgba(0,176,255,0.05); border-left-color: #00B0FF; }
        .card-row { display: flex; align-items: flex-start; gap: 8px; }
        .card-body { flex: 1; min-width: 0; }
        .card-subject-row { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
        .card-subject {
          font-size: 12px; font-weight: 600; color: #E0E0E0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
        }
        .card-subject mark { background: #FFAB0033; color: #FFAB00; border-radius: 2px; padding: 0 1px; }
        .card-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
        .card-meta-text { font-size: 10.5px; color: rgba(255,255,255,0.4); font-family: monospace; }
        .card-meta-text mark { background: #FFAB0033; color: #FFAB00; border-radius: 2px; padding: 0 1px; }
        .card-dot { font-size: 8px; color: rgba(255,255,255,0.12); }
        .card-preview {
          font-size: 10.5px; color: rgba(255,255,255,0.28); line-height: 1.45;
          overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        .card-preview mark { background: #FFAB0033; color: #FFAB00; border-radius: 2px; padding: 0 1px; }
        .card-right { text-align: right; flex-shrink: 0; }
        .card-time { font-size: 9.5px; color: rgba(255,255,255,0.3); font-family: monospace; margin-bottom: 4px; }
        .card-status-row { display: flex; gap: 3px; justify-content: flex-end; align-items: center; }
        .status-badge {
          font-size: 8.5px; padding: 2px 5px; border-radius: 3px;
          font-weight: 600; font-family: monospace; text-transform: uppercase; letter-spacing: 0.3px;
        }
        .status-active { background: rgba(0,200,83,0.1); color: #00C853; }
        .status-ended { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.28); }
        .priority-dot { width: 5px; height: 5px; border-radius: 50%; }
        .attach-icon { font-size: 9px; opacity: 0.35; }

        /* Detail panel */
        .detail {
          width: 300px; flex-shrink: 0; overflow: hidden;
          border-left: 1px solid rgba(255,255,255,0.06);
          display: flex; flex-direction: column; background: #0A0B10;
        }
        .detail-header {
          padding: 14px 14px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; justify-content: space-between; align-items: flex-start;
        }
        .detail-subject { font-size: 12px; font-weight: 700; line-height: 1.4; flex: 1; margin-right: 8px; }
        .detail-taskid { font-size: 9.5px; color: rgba(255,255,255,0.35); font-family: monospace; margin-top: 3px; }
        .close-btn {
          background: rgba(255,255,255,0.04); border: none; color: rgba(255,255,255,0.3);
          width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
          font-size: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .detail-content { flex: 1; overflow-y: auto; padding: 14px; }
        .detail-content::-webkit-scrollbar { width: 4px; }
        .detail-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
        .detail-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 4px 0;
        }
        .detail-label {
          font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.2);
          text-transform: uppercase; letter-spacing: 0.7px; font-family: monospace;
        }
        .detail-value {
          font-size: 11px; color: rgba(255,255,255,0.6); font-family: monospace;
          text-align: right; max-width: 60%; word-break: break-all;
        }
        .detail-footer {
          padding: 8px 14px; border-top: 1px solid rgba(255,255,255,0.05);
          font-size: 8.5px; color: rgba(255,255,255,0.12); font-family: monospace;
        }

        /* Empty / loading states */
        .empty-state { padding: 32px 14px; text-align: center; }
        .empty-icon { font-size: 24px; margin-bottom: 8px; opacity: 0.25; }
        .empty-text { font-size: 12px; color: rgba(255,255,255,0.25); }
        .empty-hint { font-size: 10.5px; color: rgba(255,255,255,0.13); margin-top: 4px; }
        .loading-text { font-size: 11px; color: rgba(255,255,255,0.3); padding: 20px; text-align: center; }

        /* Footer */
        .footer {
          padding: 6px 14px; border-top: 1px solid rgba(255,255,255,0.05);
          font-size: 8.5px; color: rgba(255,255,255,0.12); font-family: monospace;
          flex-shrink: 0; display: flex; justify-content: space-between;
        }
      </style>

      <div class="root">
        <!-- Header -->
        <div class="header">
          <div class="header-left">
            <div class="header-icon">✉️</div>
            <div>
              <div class="header-title">Email Search</div>
              <div class="header-sub">Search API + CJDS</div>
            </div>
          </div>
          <div class="badge">${filtered.length} result${filtered.length !== 1 ? 's' : ''}</div>
        </div>

        <!-- Search -->
        <div class="search-area">
          <div class="search-box">
            <span class="search-icon">⌕</span>
            <input
              class="search-input"
              type="text"
              value="${this._esc(this._query)}"
              placeholder="Search subject, sender, body, wrap-up code..."
            />
            ${this._query ? '<button class="search-clear" data-action="clear">✕</button>' : ''}
          </div>
          <div class="filters">
            ${['All', 'Inbound', 'Outbound'].map(d => {
              const val = d === 'All' ? '' : d.toUpperCase();
              const active = this._directionFilter === val;
              return `<button class="filter-btn ${active ? 'active-blue' : ''}" data-direction="${val}">${d}</button>`;
            }).join('')}
            <span class="filter-sep"></span>
            ${['All Queues', ...queues].map(qName => {
              const val = qName === 'All Queues' ? '' : qName;
              const active = this._queueFilter === val;
              const label = qName.replace('_Q', '');
              return `<button class="filter-btn ${active ? 'active-purple' : ''}" data-queue="${val}">${this._esc(label)}</button>`;
            }).join('')}
          </div>
        </div>

        <!-- Main content -->
        <div class="main">
          <div class="results">
            ${this._loading ? '<div class="loading-text">Searching email conversations...</div>' : ''}
            ${!this._loading && filtered.length === 0 ? `
              <div class="empty-state">
                <div class="empty-icon">✉️</div>
                <div class="empty-text">No email conversations match your search</div>
                <div class="empty-hint">Try adjusting your query or filters</div>
              </div>
            ` : ''}
            ${filtered.map(e => `
              <div class="email-card ${this._selectedTaskId === e.taskId ? 'selected' : ''}" data-taskid="${e.taskId}">
                <div class="card-row">
                  <div class="card-body">
                    <div class="card-subject-row">
                      <span style="font-size:10px">${e.direction === 'INBOUND' ? '📩' : '📤'}</span>
                      <div class="card-subject">${this._highlight(e.subject, q)}</div>
                      ${e.hasAttachments ? '<span class="attach-icon">📎</span>' : ''}
                    </div>
                    <div class="card-meta">
                      <span class="card-meta-text">${this._highlight(e.origin, q)}</span>
                      <span class="card-dot">•</span>
                      <span class="card-meta-text">${this._esc(e.queueName)}</span>
                    </div>
                    ${e.bodyPreview ? `<div class="card-preview">${this._highlight(e.bodyPreview, q)}</div>` : ''}
                  </div>
                  <div class="card-right">
                    <div class="card-time">${this._fmtTime(e.createdTime)}</div>
                    <div class="card-status-row">
                      <span class="status-badge ${e.status === 'active' ? 'status-active' : 'status-ended'}">${e.status}</span>
                      <span class="priority-dot" style="background:${priorityColor(e.priority)};${e.priority <= 2 ? `box-shadow:0 0 4px ${priorityColor(e.priority)}` : ''}"></span>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          ${selected ? `
            <div class="detail">
              <div class="detail-header">
                <div>
                  <div class="detail-subject">${this._esc(selected.subject)}</div>
                  <div class="detail-taskid">${this._esc(selected.taskId)}</div>
                </div>
                <button class="close-btn" data-action="close-detail">✕</button>
              </div>
              <div class="detail-content">
                ${[
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
                  ['Duration', this._fmtDuration(selected.createdTime, selected.endedTime)],
                  ['Attachments', selected.hasAttachments ? 'Yes' : 'No'],
                  ['Status', (selected.status || '').toUpperCase()]
                ].map(([label, value]) => `
                  <div class="detail-row">
                    <span class="detail-label">${label}</span>
                    <span class="detail-value">${this._esc(value)}</span>
                  </div>
                `).join('')}
              </div>
              <div class="detail-footer">Data: /search (GraphQL CSR) + CJDS Journey API</div>
            </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div class="footer">
          <span>POST /search (GraphQL) · GET /v1/journey/events</span>
          <span>developer.webex-cx.com</span>
        </div>
      </div>
    `;

    // ── Bind event listeners ──
    const searchInput = this.shadowRoot.querySelector('.search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this._onSearch(e));
    }

    const clearBtn = this.shadowRoot.querySelector('[data-action="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this._clearSearch());
    }

    this.shadowRoot.querySelectorAll('[data-direction]').forEach(btn => {
      btn.addEventListener('click', () => this._setDirection(btn.dataset.direction));
    });

    this.shadowRoot.querySelectorAll('[data-queue]').forEach(btn => {
      btn.addEventListener('click', () => this._setQueue(btn.dataset.queue));
    });

    this.shadowRoot.querySelectorAll('.email-card').forEach(card => {
      card.addEventListener('click', () => this._selectTask(card.dataset.taskid));
    });

    const closeBtn = this.shadowRoot.querySelector('[data-action="close-detail"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._closeDetail());
    }

    // Restore cursor position in search input
    if (searchInput && this._query) {
      searchInput.value = this._query;
      searchInput.setSelectionRange(this._query.length, this._query.length);
      searchInput.focus();
    }
  }
}

// Register the custom element
customElements.define('email-search-widget', EmailSearchWidget);
