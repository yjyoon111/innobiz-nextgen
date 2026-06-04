const KRW = "원";
const byId = (id) => document.getElementById(id);
const nfmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const pfmt = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMoney = (value) => `${nfmt.format(Number(value || 0))}${KRW}`;
const fmtPercent = (value) => `${pfmt.format(Number(value || 0) * 100)}%`;

let weeklyChart;
let categoryChart;
let budgetChart;
let attendanceChart;
let dashboardData;
let modalEl;
let modalTitleEl;

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
  const header = `<thead><tr>${columns.map((column) => `<th>${column.label}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => `<td>${column.render ? column.render(row[column.key], row) : (row[column.key] ?? "")}</td>`)
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
            { key: "vendor", label: "거래처" },
            { key: "detail", label: "내역" },
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
            { key: "vendor", label: "거래처" },
            { key: "detail", label: "내역" },
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

function bindBudgetChart(rows) {
  if (budgetChart) budgetChart.destroy();
  budgetChart = new Chart(byId("budgetChart"), {
    type: "bar",
    data: {
      labels: rows.map((row) => row.category),
      datasets: [
        { label: "실지출", data: rows.map((row) => row.spent), backgroundColor: "#1d3f72", borderRadius: 6 },
        { label: "남은 예산", data: rows.map((row) => Math.max(0, row.remain)), backgroundColor: "#d9e2ea", borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: (_, elements) => {
        if (!elements.length) return;
        openModal(
          "실수입 내역 상세",
          [
            { key: "name", label: "이름" },
            { key: "category", label: "구분" },
            { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
          ],
          dashboardData.income_rows,
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
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          grace: "8%",
          ticks: { callback: (value) => `${nfmt.format(value)}${KRW}` },
        },
      },
    },
  });
}

function bindAttendanceChart(rows) {
  if (attendanceChart) attendanceChart.destroy();
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
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => `${context.label}: ${pfmt.format(context.raw)}%`,
            afterLabel: (context) => {
              const row = rows[context.dataIndex];
              return `출석 ${row.attend} / 불참 ${row.absent}`;
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

function init() {
  modalEl = byId("detail-modal");
  modalTitleEl = byId("modal-title");
  byId("modal-close-btn").addEventListener("click", closeModal);
  byId("modal-close-bg").addEventListener("click", closeModal);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  loadDashboardData()
    .then((data) => {
      dashboardData = data;
      byId("meta-line").textContent = `기준: ${data.meta.completed_week_range} | 갱신: ${data.meta.generated_at} | 원본: ${data.meta.source_files.settlement_4th}`;

      renderKpis(data.kpis);
      bindWeeklyChart(data.weekly_comparison);
      bindCategoryChart(data.category_comparison);
      bindBudgetChart(data.budget_vs_actual);
      bindAttendanceChart(data.attendance.weekly);

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

      renderSimpleTable(
        "attendance-table",
        [
          { key: "name", label: "성명" },
          { key: "company", label: "업체명" },
          { key: "attend_count", label: "출석횟수" },
          { key: "check_count", label: "확인회차" },
          { key: "rate", label: "출석률", render: (value) => fmtPercent(value) },
        ],
        data.attendance.members_all,
      );

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

      renderSimpleTable(
        "budget-table",
        [
          { key: "category", label: "구분" },
          { key: "budget", label: "실수입", render: (value) => fmtMoney(value) },
          { key: "spent", label: "실지출", render: (value) => fmtMoney(value) },
          { key: "remain", label: "남은 예산", render: (value) => fmtMoney(value) },
          { key: "usage_rate", label: "지출률", render: (value) => fmtPercent(value) },
        ],
        data.budget_vs_actual,
      );

      renderSimpleTable(
        "income-table",
        [
          { key: "name", label: "이름" },
          { key: "category", label: "구분" },
          { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
        ],
        data.income_rows,
      );

      renderSimpleTable(
        "top-table",
        [
          { key: "week_label", label: "주차" },
          { key: "date", label: "일자" },
          { key: "category", label: "카테고리" },
          { key: "vendor", label: "거래처" },
          { key: "detail", label: "내역" },
          { key: "amount", label: "금액", render: (value) => fmtMoney(value) },
        ],
        data.top_transactions,
      );
    })
    .catch((error) => {
      byId("meta-line").textContent = `데이터를 불러오지 못했습니다. (${error.message})`;
      console.error(error);
    });
}

init();
