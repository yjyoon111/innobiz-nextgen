const KRW = "원";
const byId = (id) => document.getElementById(id);
const nfmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const pfmt = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMoney = (value) => `${nfmt.format(Number(value || 0))}${KRW}`;
const fmtPercent = (value) => `${pfmt.format(Number(value || 0) * 100)}%`;
const fmtCount = (value) => `${nfmt.format(Number(value || 0))}명`;

let weeklyChart;
let categoryChart;
let attendanceChart;
let dashboardData;
let modalEl;
let modalTitleEl;

const tableState = {
  attendance: { query: "", sort: "rate_desc", expanded: false },
  income: { query: "", sort: "amount_desc", expanded: false },
  top: { query: "", sort: "amount_desc", expanded: false },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clipText(value, length = 18) {
  const text = String(value ?? "");
  const clipped = text.length > length ? `${text.slice(0, length - 1)}…` : text;
  return `<span class="text-clip" title="${escapeHtml(text)}">${escapeHtml(clipped)}</span>`;
}

function renderKpis(kpis) {
  const cards = [
    ["4기 누적 지출", fmtMoney(kpis.spent_current), ""],
    ["3기 동일구간 지출", fmtMoney(kpis.spent_prev_same_period), ""],
    ["증감액 (4기-3기)", fmtMoney(kpis.diff_amount), kpis.diff_amount >= 0 ? "negative" : "positive"],
    ["증감률", fmtPercent(kpis.diff_rate), kpis.diff_rate >= 0 ? "negative" : "positive"],
    ["실수입 총액", fmtMoney(kpis.income_total), ""],
    ["실수입 대비 지출률", fmtPercent(kpis.budget_usage_rate), ""],
    ["남은 예산", fmtMoney(kpis.remaining_budget), "positive"],
  ];

  byId("kpi-grid").innerHTML = cards
    .map(
      ([label, value, className]) => `
        <article class="kpi-card">
          <p class="kpi-label">${label}</p>
          <p class="kpi-value ${className}">${value}</p>
        </article>
      `,
    )
    .join("");
}

function renderSimpleTable(tableId, columns, rows) {
  const table = byId(tableId);
  const header = `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => {
            const value = row[column.key];
            if (column.render) return `<td>${column.render(value, row)}</td>`;
            return `<td>${escapeHtml(value ?? "")}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;
  table.innerHTML = `${header}${body}`;
}

function openModal(title, columns, rows) {
  renderSimpleTable("drilldown-table", columns, rows);
  modalTitleEl.textContent = `${title} (${rows.length}건)`;
  modalEl.classList.add("show");
  modalEl.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modalEl.classList.remove("show");
  modalEl.setAttribute("aria-hidden", "true");
}

function showMemberDetail(name) {
  if (!dashboardData || !dashboardData.attendance) return;
  const weekly = dashboardData.attendance.weekly || [];
  const has = (list, target) => (list || []).some((person) => person.name === target);
  const rows = weekly.map((week) => {
    let status;
    if (has(week.attendees, name)) status = week.trip ? "참가" : "출석";
    else if (has(week.absentees, name)) status = "불참";
    else status = "-";
    return { week_label: week.week_label, date: week.date, status, trip: week.trip };
  });
  const attendCount = rows.filter((row) => row.status === "출석").length;
  const tripCount = rows.filter((row) => row.status === "참가").length;
  openModal(
    `${name} 주차별 출석 현황 — 정규 ${attendCount}회${tripCount ? " (+해외연수 참가)" : ""}`,
    [
      { key: "week_label", label: "주차", render: (value, row) => (row.trip ? `${value} (해외연수)` : value) },
      { key: "date", label: "일자" },
      {
        key: "status",
        label: "출석 여부",
        render: (value) => {
          const color = value === "불참" ? "#c33b2f" : value === "참가" ? "#c8851f" : value === "출석" ? "#0f8b4c" : "#9aa0a6";
          const text = value === "-" ? "해당없음" : value;
          return `<span style="font-weight:700;color:${color}">${text}</span>`;
        },
      },
    ],
    rows,
  );
}
window.showMemberDetail = showMemberDetail;

function bindWeeklyChart(rows) {
  if (weeklyChart) weeklyChart.destroy();
  weeklyChart = new Chart(byId("weeklyChart"), {
    type: "bar",
    data: {
      labels: rows.map((row) => row.week_label),
      datasets: [
        { label: "3기", data: rows.map((row) => row.prev_amount), borderRadius: 8, backgroundColor: "#7b8b9a" },
        { label: "4기", data: rows.map((row) => row.current_amount), borderRadius: 8, backgroundColor: "#186f65" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: (_, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        const datasetIndex = elements[0].datasetIndex;
        const weekLabel = rows[index].week_label;
        const source = datasetIndex === 0 ? dashboardData.prev_transactions : dashboardData.current_transactions;
        openModal(
          `${weekLabel} ${datasetIndex === 0 ? "3기" : "4기"} 지출 상세`,
          [
            { key: "date", label: "일자" },
            { key: "category", label: "카테고리" },
            { key: "vendor", label: "거래처", render: (value) => clipText(value, 16) },
            { key: "detail", label: "내역", render: (value) => clipText(value, 24) },
            { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
          ],
          source.filter((row) => row.week_label === weekLabel),
        );
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${fmtMoney(context.raw)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: "8%",
          ticks: { callback: (value) => `${nfmt.format(value)}${KRW}` },
        },
      },
    },
  });
}

function bindCategoryChart(rows) {
  if (categoryChart) categoryChart.destroy();
  const colors = ["#f07f45", "#186f65", "#1d3f72", "#d35f5f", "#8f6db4", "#2c93b9", "#84a13d"];
  categoryChart = new Chart(byId("categoryChart"), {
    type: "doughnut",
    data: {
      labels: rows.map((row) => row.category),
      datasets: [
        {
          data: rows.map((row) => row.current_amount),
          backgroundColor: rows.map((_, index) => colors[index % colors.length]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: (_, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        const category = rows[index].category;
        openModal(
          `${category} 지출 상세`,
          [
            { key: "week_label", label: "주차" },
            { key: "date", label: "일자" },
            { key: "vendor", label: "거래처", render: (value) => clipText(value, 16) },
            { key: "detail", label: "내역", render: (value) => clipText(value, 24) },
            { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
          ],
          dashboardData.current_transactions.filter((row) => row.category === category),
        );
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => `${context.label}: ${fmtMoney(context.raw)}`,
          },
        },
      },
    },
  });
}

function bindAttendanceChart(rows) {
  if (attendanceChart) attendanceChart.destroy();
  rows = rows.filter((row) => !row.trip); // 해외연수(5주차)는 출석률이 아니므로 차트에서 제외
  attendanceChart = new Chart(byId("attendanceChart"), {
    type: "line",
    data: {
      labels: rows.map((row) => row.week_label),
      datasets: [
        {
          label: "출석률",
          data: rows.map((row) => Number((row.rate * 100).toFixed(2))),
          borderColor: "#186f65",
          backgroundColor: "rgba(24,111,101,0.16)",
          fill: true,
          tension: 0.25,
          pointRadius: 10,
          pointHoverRadius: 12,
          pointHitRadius: 0,
          pointBorderWidth: 3,
          pointBorderColor: rows.map((row) => (row.trip ? "#c8851f" : "#186f65")),
          pointBackgroundColor: rows.map((row) => (row.trip ? "#fdf3e3" : "#f7f5f0")),
          pointHoverBorderWidth: 4,
          pointHoverBorderColor: rows.map((row) => (row.trip ? "#a96d12" : "#0f5d55")),
          pointHoverBackgroundColor: rows.map((row) => (row.trip ? "#c8851f" : "#186f65")),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
        axis: "x",
      },
      hover: {
        mode: "index",
        intersect: false,
      },
      elements: {
        point: {
          radius: 10,
          hoverRadius: 12,
          hitRadius: 0,
        },
      },
      onClick: (_, elements) => {
        if (!elements.length) return;
        const row = rows[elements[0].index];
        const people = [
          ...(row.attendees || []).map((person) => ({ ...person, status: row.trip ? "참가" : "출석" })),
          ...(row.absentees || []).map((person) => ({ ...person, status: "불참" })),
        ];
        if (!people.length) return;
        openModal(
          row.trip
            ? `${row.week_label} 해외연수 참가 명단 — 참가 ${row.attend}명 (출석률 집계 제외)`
            : `${row.week_label} 출석 명단 — 출석 ${row.attend}명 / 불참 ${row.absent}명`,
          [
            {
              key: "status",
              label: "구분",
              render: (value) =>
                `<span style="font-weight:700;color:${value === "불참" ? "#c33b2f" : value === "참가" ? "#c8851f" : "#0f8b4c"}">${value}</span>`,
            },
            { key: "name", label: "성명" },
            { key: "company", label: "업체명", render: (value) => clipText(value, 18) },
          ],
          people,
        );
      },
      plugins: {
        tooltip: {
          enabled: true,
          displayColors: false,
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => {
              const row = rows[items[0].dataIndex];
              return row.trip ? `${items[0].label} 해외연수 참가율` : `${items[0].label} 출석률`;
            },
            label: (context) => {
              const row = rows[context.dataIndex];
              if (row.trip) {
                return `참가 ${fmtCount(row.attend)} | 참가율 ${pfmt.format(context.raw)}% (출석률 집계 제외)`;
              }
              const total = Number(row.attend || 0) + Number(row.absent || 0);
              return `출석 ${fmtCount(row.attend)} / 전체 ${fmtCount(total)} | 출석률 ${pfmt.format(context.raw)}%${row.absent ? ` | 불참 ${fmtCount(row.absent)}` : ""}`;
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } },
      },
    },
  });
}

function loadDashboardData() {
  if (window.DASHBOARD_DATA) return Promise.resolve(window.DASHBOARD_DATA);
  return fetch(`./data/dashboard.json?t=${Date.now()}`).then((response) => {
    if (!response.ok) throw new Error("대시보드 데이터를 불러오지 못했습니다.");
    return response.json();
  });
}

function sortRows(rows, state, sorters) {
  const sorted = [...rows];
  const sorter = sorters[state.sort] || sorters.default;
  if (sorter) sorted.sort(sorter);
  return sorted;
}

function filterRows(rows, query, fields) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => fields.some((field) => String(row[field] ?? "").toLowerCase().includes(needle)));
}

function renderManagedTable(name) {
  if (!dashboardData) return;
  const configs = {
    attendance: {
      tableId: "attendance-table",
      countId: "attendance-count",
      moreId: "attendance-more",
      searchId: "attendance-search",
      sortId: "attendance-sort",
      rows: () => dashboardData.attendance.members_all,
      fields: ["name", "company"],
      limit: 10,
      sorters: {
        rate_desc: (a, b) => b.rate - a.rate || b.attend_count - a.attend_count || a.name.localeCompare(b.name, "ko"),
        rate_asc: (a, b) => a.rate - b.rate || a.attend_count - b.attend_count || a.name.localeCompare(b.name, "ko"),
        attend_desc: (a, b) => b.attend_count - a.attend_count || b.rate - a.rate || a.name.localeCompare(b.name, "ko"),
        name_asc: (a, b) => a.name.localeCompare(b.name, "ko"),
      },
      columns: [
        { key: "name", label: "성명" },
        { key: "company", label: "업체명", render: (value) => clipText(value, 14) },
        {
          key: "attend_count",
          label: "출석횟수",
          render: (value, row) =>
            `<button type="button" class="attend-detail-btn" onclick="showMemberDetail('${escapeHtml(row.name).replaceAll("'", "\\'")}')">${value}회</button>`,
        },
        { key: "rate", label: "출석률", render: (value) => fmtPercent(value) },
      ],
    },
    income: {
      tableId: "income-table",
      countId: "income-count",
      moreId: "income-more",
      searchId: "income-search",
      sortId: "income-sort",
      rows: () => dashboardData.income_rows,
      fields: ["name", "category"],
      limit: 10,
      sorters: {
        amount_desc: (a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ko"),
        amount_asc: (a, b) => a.amount - b.amount || a.name.localeCompare(b.name, "ko"),
        name_asc: (a, b) => a.name.localeCompare(b.name, "ko"),
        category_asc: (a, b) => a.category.localeCompare(b.category, "ko") || b.amount - a.amount,
      },
      columns: [
        { key: "name", label: "이름", render: (value) => clipText(value, 10) },
        { key: "category", label: "구분", render: (value) => clipText(value, 14) },
        { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
      ],
    },
    top: {
      tableId: "top-table",
      countId: "top-count",
      moreId: "top-more",
      searchId: "top-search",
      sortId: "top-sort",
      rows: () => dashboardData.top_transactions,
      fields: ["week_label", "date", "category", "vendor", "detail"],
      limit: 10,
      sorters: {
        amount_desc: (a, b) => b.amount - a.amount || a.week_label.localeCompare(b.week_label, "ko"),
        amount_asc: (a, b) => a.amount - b.amount || a.week_label.localeCompare(b.week_label, "ko"),
        week_asc: (a, b) => a.week_label.localeCompare(b.week_label, "ko") || b.amount - a.amount,
        detail_asc: (a, b) => String(a.detail || "").localeCompare(String(b.detail || ""), "ko") || b.amount - a.amount,
      },
      columns: [
        { key: "week_label", label: "주차" },
        { key: "date", label: "일자" },
        { key: "category", label: "카테고리" },
        { key: "vendor", label: "거래처", render: (value) => clipText(value, 12) },
        { key: "detail", label: "내역", render: (value) => clipText(value, 24) },
        { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
      ],
    },
  };

  const cfg = configs[name];
  const state = tableState[name];
  let rows = filterRows(cfg.rows(), state.query, cfg.fields);
  rows = sortRows(rows, state, cfg.sorters);
  const total = rows.length;
  const visible = state.expanded ? rows : rows.slice(0, cfg.limit);

  renderSimpleTable(cfg.tableId, cfg.columns, visible);
  const countEl = byId(cfg.countId);
  if (countEl) {
    const shownText = state.expanded || total <= cfg.limit ? `${total}건 전체` : `${visible.length}/${total}건`;
    countEl.textContent = shownText;
  }

  const moreBtn = byId(cfg.moreId);
  if (moreBtn) {
    if (total <= cfg.limit) {
      moreBtn.style.display = "none";
    } else {
      moreBtn.style.display = "inline-flex";
      moreBtn.textContent = state.expanded ? "접기" : `더보기 (${total - cfg.limit}건)`;
    }
  }
}

function bindManagedTable(name) {
  const cfg = {
    attendance: {
      searchId: "attendance-search",
      sortId: "attendance-sort",
      moreId: "attendance-more",
    },
    income: {
      searchId: "income-search",
      sortId: "income-sort",
      moreId: "income-more",
    },
    top: {
      searchId: "top-search",
      sortId: "top-sort",
      moreId: "top-more",
    },
  }[name];

  const state = tableState[name];
  byId(cfg.searchId).addEventListener("input", (event) => {
    state.query = event.target.value;
    state.expanded = false;
    renderManagedTable(name);
  });
  byId(cfg.sortId).addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.expanded = false;
    renderManagedTable(name);
  });
  byId(cfg.moreId).addEventListener("click", () => {
    state.expanded = !state.expanded;
    renderManagedTable(name);
  });
}

function renderBudgetSummary(data) {
  const kpis = data.kpis;
  const incomeSummary = data.income_summary || [];
  const shareTotal = incomeSummary.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 1;
  const spent = Number(kpis.spent_current || 0);
  const remain = Number(kpis.remaining_budget || 0);
  const rate = Number(kpis.budget_usage_rate || 0);
  const spentPct = Math.max(0, Math.min(100, rate * 100));

  byId("budget-summary").innerHTML = `
    <div class="budget-summary-grid">
      <div class="budget-stat primary">
        <span>실수입</span>
        <strong>${fmtMoney(kpis.income_total)}</strong>
      </div>
      <div class="budget-stat">
        <span>실지출</span>
        <strong>${fmtMoney(spent)}</strong>
      </div>
      <div class="budget-stat">
        <span>잔액</span>
        <strong>${fmtMoney(remain)}</strong>
      </div>
      <div class="budget-stat">
        <span>집행률</span>
        <strong>${fmtPercent(rate)}</strong>
      </div>
    </div>
    <div class="budget-progress" aria-label="실수입 대비 지출 진행률">
      <div class="budget-progress-track">
        <div class="budget-progress-fill" style="width:${spentPct}%"></div>
      </div>
      <div class="budget-progress-caption">
        <span>실지출 ${fmtMoney(spent)}</span>
        <span>실수입 ${fmtMoney(kpis.income_total)}</span>
      </div>
    </div>
    <div class="budget-source-list">
      ${incomeSummary
        .map(
          (row) => `
            <div class="budget-source-chip">
              <span>${escapeHtml(row.category)}</span>
              <strong>${fmtMoney(row.amount)}</strong>
              <em>${pfmt.format((row.amount / shareTotal) * 100)}%</em>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderIncomeSummaryTable(data) {
  const rows = (data.income_summary || []).map((row) => ({
    ...row,
    share: row.amount / (data.kpis.income_total || 1),
  }));
  renderSimpleTable(
    "budget-table",
    [
      { key: "category", label: "실수입 구분" },
      { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
      { key: "share", label: "비중", render: (value) => fmtPercent(value) },
    ],
    rows,
  );
}

function init() {
  modalEl = byId("detail-modal");
  modalTitleEl = byId("modal-title");
  byId("modal-close-btn").addEventListener("click", closeModal);
  byId("modal-close-bg").addEventListener("click", closeModal);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  bindManagedTable("attendance");
  bindManagedTable("income");
  bindManagedTable("top");

  loadDashboardData()
    .then((data) => {
      dashboardData = data;
      byId("meta-line").textContent = `기준: ${data.meta.completed_week_range} | 갱신: ${data.meta.generated_at} | 원본: ${data.meta.source_files.settlement_4th}`;

      renderKpis(data.kpis);
      bindWeeklyChart(data.weekly_comparison);
      bindCategoryChart(data.category_comparison);
      bindAttendanceChart(data.attendance.weekly);
      renderBudgetSummary(data);
      renderIncomeSummaryTable(data);

      renderSimpleTable(
        "weekly-table",
        [
          { key: "week_label", label: "주차" },
          { key: "prev_amount", label: "3기", render: (value) => fmtMoney(value) },
          { key: "current_amount", label: "4기", render: (value) => fmtMoney(value) },
          {
            key: "diff_amount",
            label: "증감액",
            render: (value) => `<span style="color:${value >= 0 ? "#c33b2f" : "#0f8b4c"}">${fmtMoney(value)}</span>`,
          },
          {
            key: "diff_rate",
            label: "증감률",
            render: (value) => `<span style="color:${value >= 0 ? "#c33b2f" : "#0f8b4c"}">${fmtPercent(value)}</span>`,
          },
        ],
        data.weekly_comparison,
      );

      renderManagedTable("attendance");
      renderSimpleTable(
        "category-table",
        [
          { key: "category", label: "카테고리" },
          { key: "prev_amount", label: "3기", render: (value) => fmtMoney(value) },
          { key: "current_amount", label: "4기", render: (value) => fmtMoney(value) },
          {
            key: "diff_amount",
            label: "증감액",
            render: (value) => `<span style="color:${value >= 0 ? "#c33b2f" : "#0f8b4c"}">${fmtMoney(value)}</span>`,
          },
          {
            key: "diff_rate",
            label: "증감률",
            render: (value) => `<span style="color:${value >= 0 ? "#c33b2f" : "#0f8b4c"}">${fmtPercent(value)}</span>`,
          },
        ],
        data.category_comparison,
      );
      renderManagedTable("income");
      renderManagedTable("top");
    })
    .catch((error) => {
      byId("meta-line").textContent = `데이터를 불러오지 못했습니다. (${error.message})`;
      console.error(error);
    });
}

init();
