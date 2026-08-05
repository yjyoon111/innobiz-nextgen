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

function renderSimpleTable(tableId, columns, rows, totalRow) {
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
  const foot = totalRow
    ? `<tfoot><tr class="total-row">${columns
        .map((column) => {
          const value = totalRow[column.key];
          if (value === undefined || value === null) return `<td></td>`;
          if (column.render) return `<td>${column.render(value, totalRow)}</td>`;
          return `<td>${escapeHtml(value)}</td>`;
        })
        .join("")}</tr></tfoot>`
    : "";
  table.innerHTML = `${header}${body}${foot}`;
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

function downloadAttendanceExcel() {
  if (!dashboardData || !dashboardData.attendance || typeof XLSX === "undefined") {
    alert("데이터 준비 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  const weekly = dashboardData.attendance.weekly || [];
  const has = (list, target) => (list || []).some((person) => person.name === target);

  // 시트1: 개인별 출석현황 (이름 가나다순)
  const members = [...dashboardData.attendance.members_all].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const memberRows = members.map((m, index) => {
    const row = { 번호: index + 1, 성명: m.name, 업체명: m.company };
    weekly.forEach((week) => {
      const label = week.trip ? `${week.week_label}(해외연수)` : week.week_label;
      let status;
      if (has(week.attendees, m.name)) status = week.trip ? "참가" : "참석";
      else if (has(week.absentees, m.name)) status = "불참";
      else status = "-";
      row[label] = status;
    });
    row["출석횟수"] = m.attend_count;
    row["확인가능회차"] = m.check_count;
    row["출석률"] = `${(m.rate * 100).toFixed(1)}%`;
    return row;
  });

  // 시트2: 주차별 출석현황
  const weekRows = weekly.map((week) => ({
    주차: week.week_label,
    일자: week.date,
    구분: week.trip ? "해외연수" : "정규",
    출석: week.attend,
    불참: week.absent,
    출석률: week.trip ? "집계 제외" : `${(week.rate * 100).toFixed(1)}%`,
  }));

  const workbook = XLSX.utils.book_new();
  const memberSheet = XLSX.utils.json_to_sheet(memberRows);
  memberSheet["!cols"] = [{ wch: 5 }, { wch: 8 }, { wch: 22 }].concat(weekly.map(() => ({ wch: 10 })), [{ wch: 9 }, { wch: 12 }, { wch: 9 }]);
  const weekSheet = XLSX.utils.json_to_sheet(weekRows);
  weekSheet["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 6 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, memberSheet, "개인별 출석현황");
  XLSX.utils.book_append_sheet(workbook, weekSheet, "주차별 출석현황");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `차경4기_출석현황_${today}.xlsx`);
}

// 막대 위에 금액(만원 단위) 표시
const barValueLabels = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 10px Pretendard, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      ctx.fillStyle = di === 0 ? "#5c6b78" : "#12564e";
      meta.data.forEach((bar, i) => {
        const value = Number(dataset.data[i] || 0);
        if (!value) return;
        const text = value >= 10000 ? `${Math.round(value / 10000).toLocaleString("ko-KR")}만` : `${nfmt.format(value)}`;
        ctx.fillText(text, bar.x, bar.y - 3);
      });
    });
    ctx.restore();
  },
};

function bindWeeklyChart(rows) {
  if (weeklyChart) weeklyChart.destroy();
  weeklyChart = new Chart(byId("weeklyChart"), {
    plugins: [barValueLabels],
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

let surveyWeeklyChart;

function renderSurvey(survey) {
  if (!survey || !survey.available) {
    byId("panel-survey").innerHTML = `<section class="panel"><p class="panel-note">만족도 조사 데이터가 없습니다.</p></section>`;
    return;
  }

  byId("survey-kpi").innerHTML = [
    ["전반적 만족도", `${survey.overall_avg} / 5`, "positive"],
    ["액션러닝 만족도", `${survey.action_avg} / 5`, ""],
    ["응답 인원", `${survey.respondents}명`, ""],
    ["주관식 의견", `${(survey.comments || []).length}건`, ""],
  ]
    .map(
      ([label, value, cls]) => `
        <article class="kpi-card">
          <p class="kpi-label">${label}</p>
          <p class="kpi-value ${cls}">${value}</p>
        </article>`,
    )
    .join("");

  // 주차별 강의 만족도
  const weekly = survey.weekly || [];
  if (surveyWeeklyChart) surveyWeeklyChart.destroy();
  surveyWeeklyChart = new Chart(byId("surveyWeeklyChart"), {
    type: "bar",
    data: {
      labels: weekly.map((w) => w.label.replace(/^(\d+주)\.\s*/, "$1 ")),
      datasets: [{ label: "만족도", data: weekly.map((w) => w.avg), backgroundColor: "#186f65", borderRadius: 8 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const row = weekly[ctx.dataIndex];
              return `평균 ${row.avg}점 (응답 ${row.n}명, 불참 ${row.absent}명)`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, max: 5, ticks: { stepSize: 1 } } },
    },
  });

  renderSimpleTable(
    "survey-lecturer-table",
    [
      { key: "label", label: "강사", render: (v) => clipText(v, 24) },
      { key: "avg", label: "만족도", render: (v) => `<span class="survey-score">${v} / 5</span>` },
      { key: "n", label: "응답", render: (v) => `${v}명` },
    ],
    survey.lecturer || [],
  );

  // 주관식 의견
  const comments = survey.comments || [];
  const topics = [...new Set(comments.map((c) => c.topic))];
  const filter = byId("survey-comment-filter");
  filter.innerHTML =
    `<option value="all">전체 보기 (${comments.length}건)</option>` +
    topics.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${comments.filter((c) => c.topic === t).length}건)</option>`).join("");
  byId("survey-comment-note").textContent = `응답자 ${survey.respondents}명이 남긴 의견 ${comments.length}건입니다.`;

  const draw = (sel) => {
    const list = sel === "all" ? comments : comments.filter((c) => c.topic === sel);
    byId("survey-comments").innerHTML = topics
      .filter((t) => list.some((c) => c.topic === t))
      .map(
        (t) => `
        <div class="comment-group">
          <p class="comment-group-title">${escapeHtml(t)}</p>
          ${list
            .filter((c) => c.topic === t)
            .map((c) => `<div class="comment-item">${escapeHtml(c.text)}</div>`)
            .join("")}
        </div>`,
      )
      .join("");
  };
  draw("all");
  filter.addEventListener("change", (e) => draw(e.target.value));
}

let nextDistChart;

function renderNextCohort(data) {
  const recos = [
    {
      title: "운영 요일·시간 재검토",
      problem: "후반부로 갈수록 출석률이 15.8%p 하락(73.2%→57.5%). 만족도는 오히려 상승해 내용 문제가 아님.",
      action: "목요일 → 금요일 이전 검토. 또는 오후 시작 시간을 늦춰 실무 부담 완화.",
      voice: "목요일 보다는 시간적 여유가 있는 금요일이 좋지 않을까 싶습니다.",
    },
    {
      title: "강의 중 휴식시간 확보",
      problem: "액션러닝 전 강의 호흡이 길어 중도 이탈이 발생. 후반 출석률 하락과 직결.",
      action: "주제 종료마다 5~10분 휴식 명시. 강사 계약 시 커리큘럼에 휴식 포함 요청.",
      voice: "호흡이 길어 중도에 나가시는 분들이 많을정도로 힘듭니다. 적어도 한 주제가 끝나면 5분에서 10분은 쉬어가는 타임이 필요합니다.",
    },
    {
      title: "AI·AX 주제 정합성 강화",
      problem: "과정명은 AX인데 무관한 강의가 있다는 지적. 4주차 만족도 4.44로 최저.",
      action: "강사 섭외 시 'AI/AX 실무 접목' 필수 조건 명시. 사전 강의계획서 검토 절차 추가.",
      voice: "AI, 그리고 AX와 관련없는 내용이 너무 많았습니다. 이 둘을 결합한 과정이라 들었는데…",
    },
    {
      title: "액션러닝 시간 확대·수준 조정",
      problem: "만족도 4.41로 전반(4.76) 대비 낮음. '시간이 짧다'와 '수준이 낮다'가 동시 지적.",
      action: "2시간 → 3시간 확대 검토, 경영자 대상에 맞는 실제 기업 과제 기반으로 재설계.",
      voice: "너무 짧은 시간 내에 이뤄지다 보니 많은 내용을 담지 못하는 부분은 아쉬웠습니다.",
    },
    {
      title: "기업 방문·네트워킹 확대",
      problem: "9주차 기업방문 출석률 37.9%로 최저였으나 만족도는 4.69로 높음. 참여 접근성 문제.",
      action: "기업방문 일정을 조기 공지하고 이동 지원 검토. 원우 간 프로그램·총동문회 요구 반영.",
      voice: "강사님들께서 근무하시는 회사에 방문하여 어떻게 운영되는지 직접 볼 수 있다면 좋겠습니다. / 차경아 총동문회를 서둘러 만들어주세요.",
    },
  ];

  byId("reco-list").innerHTML = recos
    .map(
      (r, i) => `
      <li class="reco-item">
        <div class="reco-head"><span class="reco-num">${i + 1}</span><h3>${escapeHtml(r.title)}</h3></div>
        <p class="reco-problem"><b>진단</b> ${escapeHtml(r.problem)}</p>
        <p class="reco-action"><b>제안</b> ${escapeHtml(r.action)}</p>
        <blockquote class="reco-voice">“${escapeHtml(r.voice)}”</blockquote>
      </li>`,
    )
    .join("");

  // 참여 양극화 분포
  const members = data.attendance.members_all || [];
  const buckets = [
    { label: "100% (개근)", n: members.filter((m) => m.rate >= 1).length, color: "#0f8b4c" },
    { label: "70~99%", n: members.filter((m) => m.rate >= 0.7 && m.rate < 1).length, color: "#186f65" },
    { label: "50~69%", n: members.filter((m) => m.rate >= 0.5 && m.rate < 0.7).length, color: "#e0a33e" },
    { label: "50% 미만", n: members.filter((m) => m.rate < 0.5).length, color: "#c33b2f" },
  ];
  if (nextDistChart) nextDistChart.destroy();
  nextDistChart = new Chart(byId("nextDistChart"), {
    type: "doughnut",
    data: {
      labels: buckets.map((b) => `${b.label} · ${b.n}명`),
      datasets: [{ data: buckets.map((b) => b.n), backgroundColor: buckets.map((b) => b.color), borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        tooltip: { callbacks: { label: (c) => `${c.label} (${((c.raw / members.length) * 100).toFixed(0)}%)` } },
      },
    },
  });

  // 지출 구조
  const spent = data.kpis.spent_current || 1;
  renderSimpleTable(
    "next-cost-table",
    [
      { key: "category", label: "항목" },
      { key: "current_amount", label: "금액", render: (v) => fmtMoney(v) },
      { key: "share", label: "비중", render: (v) => fmtPercent(v) },
    ],
    (data.category_comparison || []).map((c) => ({ ...c, share: c.current_amount / spent })),
    { category: "합계", current_amount: spent, share: 1 },
  );

  // 체크리스트
  const checks = [
    ["모집", "AX 실무 접목 커리큘럼임을 모집 요강에 명시 (4기 지적사항)"],
    ["모집", "목요일 외 요일 가능성 사전 수요조사"],
    ["강사", "강사 계약 시 AI/AX 연계 및 휴식시간 포함 조건 명시"],
    ["강사", "만족도 상위 강사 우선 재섭외 (김창원 4.93 · 이상진 4.80 · 김대식 4.77)"],
    ["운영", "주제별 5~10분 휴식 편성"],
    ["운영", "액션러닝 시간 확대 및 경영자 수준 과제로 재설계"],
    ["운영", "기업방문·해외연수 일정 조기 확정 및 사전 공지"],
    ["예산", `1인당 지출 ${nfmt.format(Math.round(spent / (members.length || 1)))}원 기준으로 5기 단가 설계`],
    ["예산", "해외연수가 전체 지출의 33.5% — 참가비 구조 재검토"],
    ["사후", "원우회·총동문회 구성 지원 (수료생 요청사항)"],
  ];
  const groups = [...new Set(checks.map((c) => c[0]))];
  byId("next-checklist").innerHTML = groups
    .map(
      (g) => `
      <div class="check-group">
        <p class="check-group-title">${g}</p>
        ${checks
          .filter((c) => c[0] === g)
          .map((c) => `<label class="check-item"><input type="checkbox" /><span>${escapeHtml(c[1])}</span></label>`)
          .join("")}
      </div>`,
    )
    .join("");
}

function bindTabs() {
  const buttons = [...document.querySelectorAll(".tab-btn")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.toggle("is-active", p.id === `panel-${btn.dataset.tab}`);
      });
      // 숨겨진 상태로 그려진 차트는 크기가 0이므로 표시 직후 재계산
      [weeklyChart, categoryChart, attendanceChart, surveyWeeklyChart, nextDistChart].forEach((c) => {
        if (c) c.resize();
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

const STORAGE_KEY = "innobiz4th.pw";

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// 비밀번호로 암호화된 대시보드 데이터를 복호화한다.
// 비밀번호가 틀리면 복호화가 실패하거나 검증 표식이 맞지 않아 오류를 던진다.
async function loadDashboardData(password) {
  const response = await fetch(`./data/dashboard.enc.json?t=${Date.now()}`);
  if (!response.ok) throw new Error("데이터 파일을 불러오지 못했습니다.");
  const enc = await response.json();

  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(enc.salt), iterations: enc.iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"],
  );

  let plain;
  try {
    const buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
    plain = new TextDecoder().decode(buf);
  } catch (e) {
    throw new Error("WRONG_PASSWORD");
  }
  if (!plain.startsWith("INNOBIZ-OK|")) throw new Error("WRONG_PASSWORD");
  return JSON.parse(plain.slice("INNOBIZ-OK|".length));
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
  const gate = byId("gate");
  const form = byId("gate-form");
  const input = byId("gate-input");
  const errorEl = byId("gate-error");
  const submitBtn = byId("gate-submit");

  const unlock = async (password, fromStorage) => {
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "확인 중...";
    try {
      const data = await loadDashboardData(password);
      if (byId("gate-remember").checked) {
        localStorage.setItem(STORAGE_KEY, password);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      gate.remove();
      byId("page").hidden = false;
      startDashboard(data);
    } catch (e) {
      if (fromStorage) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        errorEl.textContent =
          e.message === "WRONG_PASSWORD" ? "비밀번호가 올바르지 않습니다." : `오류가 발생했습니다. (${e.message})`;
        input.value = "";
        input.focus();
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "열람하기";
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    unlock(value, false);
  });

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    unlock(saved, true);
  } else {
    input.focus();
  }
}

function startDashboard(loaded) {
  modalEl = byId("detail-modal");
  modalTitleEl = byId("modal-title");
  byId("modal-close-btn").addEventListener("click", closeModal);
  byId("modal-close-bg").addEventListener("click", closeModal);
  byId("attendance-download").addEventListener("click", downloadAttendanceExcel);
  byId("logout-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  bindTabs();
  bindManagedTable("attendance");
  bindManagedTable("income");
  bindManagedTable("top");

  Promise.resolve(loaded)
    .then((data) => {
      dashboardData = data;
      byId("meta-line").textContent = `기준: ${data.meta.completed_week_range} | 갱신: ${data.meta.generated_at} | 원본: ${data.meta.source_files.settlement_4th}`;

      renderKpis(data.kpis);
      bindWeeklyChart(data.weekly_comparison);
      bindCategoryChart(data.category_comparison);
      bindAttendanceChart(data.attendance.weekly);
      renderBudgetSummary(data);
      renderIncomeSummaryTable(data);
      renderSurvey(data.survey);
      renderNextCohort(data);

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
        (() => {
          return {
            week_label: "합계",
            prev_amount: data.weekly_comparison.reduce((s, r) => s + Number(r.prev_amount || 0), 0),
            current_amount: data.weekly_comparison.reduce((s, r) => s + Number(r.current_amount || 0), 0),
          };
        })(),
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
