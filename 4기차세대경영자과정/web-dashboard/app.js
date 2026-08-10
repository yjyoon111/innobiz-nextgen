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

// 꺾은선 위에 출석률(%) 표시
const lineValueLabels = {
  id: "lineValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "700 11px Pretendard, sans-serif";
    ctx.fillStyle = "#12564e";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.getDatasetMeta(0).data.forEach((pt, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v == null) return;
      ctx.fillText(`${Math.round(v)}%`, pt.x, pt.y - 12);
    });
    ctx.restore();
  },
};

function bindAttendanceChart(rows) {
  if (attendanceChart) attendanceChart.destroy();
  rows = rows.filter((row) => !row.trip); // 해외연수(5주차)는 출석률이 아니므로 차트에서 제외
  attendanceChart = new Chart(byId("attendanceChart"), {
    plugins: [lineValueLabels],
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
    ["전반적 만족도", `${Number(survey.overall_avg).toFixed(1)} / 5`, "positive"],
    ["액션러닝 만족도", `${Number(survey.action_avg).toFixed(1)} / 5`, ""],
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
      layout: { padding: { right: 40 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const row = weekly[ctx.dataIndex];
              return `평균 ${Number(row.avg).toFixed(1)}점 (응답 ${row.n}명, 불참 ${row.absent}명)`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, max: 5, ticks: { stepSize: 1 } } },
    },
    plugins: [
      {
        id: "satLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.font = "800 12px Pretendard, sans-serif";
          ctx.fillStyle = "#186f65";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            ctx.fillText(Number(weekly[i].avg).toFixed(1), bar.x + 6, bar.y);
          });
          ctx.restore();
        },
      },
    ],
  });

  renderSimpleTable(
    "survey-lecturer-table",
    [
      { key: "label", label: "강사", render: (v) => clipText(v, 24) },
      { key: "avg", label: "만족도", render: (v) => `<span class="survey-score">${Number(v).toFixed(1)} / 5</span>` },
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
      problem: "후반부로 갈수록 출석률이 40%p 하락(78%→38%). 만족도는 오히려 상승해 내용 문제가 아님.",
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
      title: "AI·AX 주제 관련 강의 확대",
      problem: "과정명은 AX인데 무관한 강의가 있다는 지적. 4주차 만족도 4.4로 최저.",
      action: "강사 섭외 시 'AI/AX 실무 접목' 필수 조건 명시. 사전 강의계획서 검토 절차 추가.",
      voice: "AI, 그리고 AX와 관련없는 내용이 너무 많았습니다. 이 둘을 결합한 과정이라 들었는데…",
    },
    {
      title: "액션러닝 콘텐츠 대상 적합성 제고",
      problem:
        "액션러닝을 통해 원우 간 친밀감을 형성하고 가까워질 수 있는 시간을 마련한 점은 긍정적으로 평가되었음. 다만 만족도는 4.4로 전반 만족도(4.8) 대비 낮았으며, 이는 차세대 경영진에 직접 관련된 실습이 아니라 일반 워크숍·조별과제 방식으로 진행된 점, 계획한 시간 안에 내용을 충분히 소화하기 어려웠던 점에 기인한 것으로 분석됨.",
      action:
        "① 경영 현안을 다루는 실제 기업 과제 기반으로 콘텐츠 재설계 ② 진행 시간을 2시간에서 3시간으로 확대하여 과제 소화 시간 확보 ③ 회차별 학습 목표를 사전 안내하여 참여 목적을 명확히 전달.",
      voice: "어색했던 원우들과 아이스브레이킹 및 더 편안하게 가까워질 수 있어서 좋았습니다. / 취지는 이해되지만 대학생들이 참여하는 교류회나 조별과제 체험처럼 진행된 점이 아쉽습니다. / 짧은 시간 내에 이뤄지다 보니 많은 내용을 담지 못한 점이 아쉬웠습니다.",
    },
    {
      title: "기업 방문 프로그램 실행",
      problem:
        "당초 9주차에 기업 방문을 계획했으나 기업 섭외가 성사되지 않아 현장 강의로 대체함. 해당 회차 출석률은 38%로 전 회차 중 가장 낮았음. 수료생 주관식에서도 기업 방문 요구가 제기됨.",
      action:
        "5기에서는 방문 기업을 과정 시작 전 확정하고 일정에 명시. 원우 소속 기업 또는 강사 소속 기업을 우선 후보로 사전 협의. 총동문회 구성 요청도 함께 검토.",
      voice: "강사님들께서 운영하시거나 근무하시는 회사에 방문하여 어떤 식으로 기업이 운영되고 있는지 직접 볼 수 있다면 좋을 것 같습니다. / 차경아 총동문회를 서둘러 만들어주세요.",
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
    { label: "전 회차 출석", n: members.filter((m) => m.rate >= 1).length, color: "#0f8b4c" },
    { label: "대부분 출석 (70~99%)", n: members.filter((m) => m.rate >= 0.7 && m.rate < 1).length, color: "#186f65" },
    { label: "절반 정도 출석 (50~69%)", n: members.filter((m) => m.rate >= 0.5 && m.rate < 0.7).length, color: "#e0a33e" },
    { label: "절반 미만 출석", n: members.filter((m) => m.rate < 0.5).length, color: "#c33b2f" },
  ];
  const total = members.length || 1;
  if (nextDistChart) nextDistChart.destroy();
  nextDistChart = new Chart(byId("nextDistChart"), {
    type: "bar",
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{ data: buckets.map((b) => b.n), backgroundColor: buckets.map((b) => b.color), borderRadius: 8 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: "y",
      layout: { padding: { right: 56 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw}명 (${((c.raw / total) * 100).toFixed(0)}%)` } },
      },
      scales: {
        x: { beginAtZero: true, max: Math.max(...buckets.map((b) => b.n)) + 3, ticks: { stepSize: 5 } },
        y: { ticks: { font: { size: 12 } } },
      },
    },
    plugins: [
      {
        id: "distLabels",
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.font = "800 13px Pretendard, sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const n = buckets[i].n;
            ctx.fillStyle = buckets[i].color;
            ctx.fillText(`${n}명 (${Math.round((n / total) * 100)}%)`, bar.x + 8, bar.y);
          });
          ctx.restore();
        },
      },
    ],
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
    ["강사", "만족도 상위 강사 우선 재섭외 (김창원 4.9 · 이상진 4.8 · 김대식 4.8)"],
    ["운영", "주제별 5~10분 휴식 편성"],
    ["운영", "액션러닝을 경영 현안 중심 실제 기업 과제로 재설계"],
    ["운영", "액션러닝 진행 시간 확대(2시간 → 3시간) 및 회차별 학습목표 사전 안내"],
    ["운영", "기업 방문처 사전 확정 (4기는 섭외 불발로 현장 강의 대체)"],
    ["운영", "해외연수 일정 조기 확정 및 사전 공지"],
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

async function captureSection(btn) {
  const targetId = btn.dataset.captureTarget;
  const target = byId(targetId);
  if (!target || typeof html2canvas === "undefined") return;

  btn.disabled = true;
  // 캡처 결과물에서 버튼 자체가 보이지 않도록 완전히 숨긴다(텍스트만 바꾸면 "저장 중"이 그대로 찍힘)
  const prevVisibility = btn.style.visibility;
  btn.style.visibility = "hidden";

  try {
    // 숨김 반영을 위해 잠시 대기 후 캡처 (requestAnimationFrame은 백그라운드 탭에서 지연될 수 있어 setTimeout 사용)
    await new Promise((resolve) => setTimeout(resolve, 30));
    const canvas = await html2canvas(target, {
      backgroundColor: "#f7f5f0",
      scale: 2,
      useCORS: true,
    });
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    link.download = `${btn.dataset.captureName || "대시보드"}_${today}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (e) {
    alert("이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  } finally {
    btn.style.visibility = prevVisibility;
    btn.disabled = false;
  }
}

// 주차별 강사 (연수일정표 기준)
const WEEK_LECTURERS = {
  1: "신제구 교수 (입학식)",
  2: "유일한 대표",
  3: "류재언 변호사",
  4: "김용진 대표",
  5: "고영 대표 (해외연수)",
  6: "이상진 본부장",
  7: "김창원 교수",
  8: "고영 대표",
  9: "한웅 대표이사",
  10: "졸업여행 (원우회 주관)",
  11: "김대식 교수 (수료식)",
};

// 결과보고서 「연수 수지」 표
function renderFinanceReport(data) {
  const kpis = data.kpis;
  const income = Number(kpis.income_total || 0);
  const spent = Number(kpis.spent_current || 0);

  renderSimpleTable(
    "finance-summary-table",
    [
      { key: "label", label: "구분" },
      { key: "value", label: "금액", render: (v) => fmtMoney(v) },
      { key: "note", label: "비고" },
    ],
    [
      { label: "수입", value: income, note: "교육비 + 해외연수 참가비" },
      { label: "지출", value: spent, note: "1~11주차 집행액" },
      { label: "수익", value: income - spent, note: `집행률 ${fmtPercent(kpis.budget_usage_rate)}` },
    ],
  );

  // 항목별 지출 — 결과보고서 양식(대분류 → 소분류 → 세부내역)
  const tx = data.current_transactions || [];
  const sumBy = (fn) => tx.filter(fn).reduce((s, t) => s + Number(t.amount || 0), 0);
  const raw = (name) => (t) => t.raw_category === name;

  const groups = [
    {
      group: "강사료",
      items: [
        { label: "강사료", filter: (t) => t.raw_category === "강의비" || t.raw_category === "강의비,진행비", note: "11회 강사료" },
        { label: "진행비", filter: raw("진행비"), note: "액션러닝 진행비" },
      ],
    },
    {
      group: "인쇄비",
      items: [
        { label: "교재·인쇄물", filter: raw("준비비"), note: "교재 제본, 회원수첩, 홍보용 웹포스터·E브로슈어, 현수막·배너" },
        { label: "수료식 인쇄", filter: raw("인쇄비"), note: "수료식 현수막, 수료증" },
      ],
    },
    {
      group: "다과 및 식비",
      items: [
        { label: "다과비", filter: raw("다과비"), note: "교육기간 커피, 다과 등" },
        { label: "식비", filter: raw("식비"), note: "교육 후 석식 등" },
      ],
    },
    {
      group: "해외연수비",
      items: [
        { label: "항공료", amount: 7590000, note: "왕복 항공료 + 유류할증료(12인 기준)" },
        { label: "숙박비", amount: 5768400, note: "상하이 호텔 3박(5성, 11인)" },
        { label: "차량·가이드·통역", amount: 2918400, note: "전용차량 + 가이드 + 전시장 현지통역" },
        { label: "식비", amount: 2061120, note: "현지 중식·석식" },
        { label: "보험·수수료", amount: 2044800, note: "여행자보험 + 핸들링차지 + 여행사 수수료" },
        { label: "환불 조정", amount: -644640, note: "최종 참가인원 감소(12→8명) 반영 환불" },
      ],
    },
    {
      group: "수료식",
      items: [{ label: "기념품", filter: raw("기념품"), note: "수료생 선물세트 60개" }],
    },
    {
      group: "교육장 임대",
      items: [
        { label: "대관료", filter: raw("대관료"), note: "7개 회차 강의실 대관" },
        { label: "회의실 임차료", filter: (t) => t.raw_category === "운영비" && t.detail.includes("회의실"), note: "9주차 보증금 및 사용료" },
      ],
    },
    {
      group: "주차비",
      items: [{ label: "주차비", filter: raw("주차비"), note: "9개 회차 관리비 정산" }],
    },
    {
      group: "운영비",
      items: [
        { label: "행사 운영비", filter: (t) => t.raw_category === "운영비" && !t.detail.includes("회의실"), note: "투썸 기프트카드(답례품 등)" },
        { label: "원우회 온라인 수첩 사이트 유지비", filter: raw("사이트관리비"), note: "온라인 수첩 사이트 웹호스팅(1년)" },
      ],
    },
  ];

  const rows = [];
  groups.forEach((g) => {
    const items = g.items
      .map((it) => ({ ...it, amount: it.amount !== undefined ? it.amount : sumBy(it.filter) }))
      .filter((it) => it.amount !== 0);
    if (!items.length) return;
    const groupTotal = items.reduce((s, it) => s + it.amount, 0);
    rows.push({ level: "group", name: g.group, amount: groupTotal, note: "" });
    // 소분류가 하나뿐이고 이름이 그룹과 같으면 중복 행을 만들지 않는다
    if (!(items.length === 1 && items[0].label === g.group)) {
      items.forEach((it) => rows.push({ level: "item", name: it.label, amount: it.amount, note: it.note }));
    } else {
      rows[rows.length - 1].note = items[0].note;
    }
  });

  renderSimpleTable(
    "finance-category-table",
    [
      {
        key: "name",
        label: "구분",
        render: (v, row) =>
          row.level === "group"
            ? `<strong>${escapeHtml(v)}</strong>`
            : `<span class="sub-item">${escapeHtml(v)}</span>`,
      },
      { key: "amount", label: "금액", render: (v, row) => (row.level === "group" ? `<strong>${fmtMoney(v)}</strong>` : fmtMoney(v)) },
      { key: "note", label: "세부내역", render: (v) => `<span class="cell-note">${escapeHtml(v || "")}</span>` },
    ],
    rows,
    { name: "합계", amount: spent, note: "" },
  );

  // 주차별 지출 + 참석인원 + 강사
  const attendByWeek = new Map((data.attendance.weekly || []).map((w) => [w.week, w]));
  const weeks = (data.weekly_comparison || []).map((w) => {
    const a = attendByWeek.get(w.week);
    return {
      week_label: w.week_label,
      lecturer: WEEK_LECTURERS[w.week] || "-",
      amount: w.current_amount,
      attend: a ? a.attend : null,
    };
  });
  renderSimpleTable(
    "finance-weekly-table",
    [
      { key: "week_label", label: "구분" },
      { key: "lecturer", label: "강사 / 내용" },
      { key: "amount", label: "금액", render: (v) => fmtMoney(v) },
      { key: "attend", label: "참석인원", render: (v) => (v === null ? "-" : `${v}명`) },
    ],
    weeks,
    { week_label: "총합계", amount: spent },
  );
}

// 당초 품의 계획 대비 (품의서 "소요예산" 계획금액 vs 실제 집행)
function renderBudgetCompare(data) {
  const tx = data.current_transactions || [];
  const sumBy = (fn) => tx.filter(fn).reduce((s, t) => s + Number(t.amount || 0), 0);
  const raw = (name) => (t) => t.raw_category === name;
  const diffCell = (plan, actual) => {
    const diff = actual - plan;
    const sign = diff >= 0 ? "▲" : "▼";
    return `${sign}${fmtMoney(Math.abs(diff))}`;
  };
  const rateCell = (plan, actual) => (plan ? fmtPercent(actual / plan) : "-");

  // 수입 비교
  const incomePlan = { 교육비: 75400000, 전시회참가비: 12390000 };
  const incomeActual = { 교육비: 81000000, 전시회참가비: 11410000 + 3585080 };
  const incomeRows = Object.keys(incomePlan).map((k) => ({
    item: k,
    plan: incomePlan[k],
    actual: incomeActual[k],
    diff: diffCell(incomePlan[k], incomeActual[k]),
    rate: rateCell(incomePlan[k], incomeActual[k]),
  }));
  const incomePlanTotal = Object.values(incomePlan).reduce((s, v) => s + v, 0);
  const incomeActualTotal = Object.values(incomeActual).reduce((s, v) => s + v, 0);

  renderSimpleTable(
    "budget-income-table",
    [
      { key: "item", label: "구분" },
      { key: "plan", label: "당초 계획", render: (v) => fmtMoney(v) },
      { key: "actual", label: "실제", render: (v) => fmtMoney(v) },
      { key: "diff", label: "차이(실제-계획)" },
      { key: "rate", label: "달성률" },
    ],
    incomeRows,
    {
      item: "합계",
      plan: incomePlanTotal,
      actual: incomeActualTotal,
      diff: diffCell(incomePlanTotal, incomeActualTotal),
      rate: rateCell(incomePlanTotal, incomeActualTotal),
    },
  );

  // 지출 비교 (품의서 "소요예산" 항목 기준, 실제는 결과보고서 항목별 지출과 매칭)
  const actualByItem = {
    강사비: sumBy((t) => t.raw_category === "강의비" || t.raw_category === "강의비,진행비" || t.raw_category === "진행비"),
    인쇄비: sumBy(raw("준비비")) + sumBy(raw("인쇄비")),
    "다과 및 식비": sumBy(raw("다과비")) + sumBy(raw("식비")),
    사무용품: 0,
    "해외전시회 참가": 19738080,
    졸업식: sumBy(raw("기념품")),
    "교육장임차 및 회원수첩": sumBy(raw("대관료")) + sumBy((t) => t.raw_category === "운영비" && t.detail.includes("회의실")),
    주차비: sumBy(raw("주차비")),
    예비비: sumBy((t) => t.raw_category === "운영비" && !t.detail.includes("회의실")),
    "원우회 온라인 수첩 사이트 유지비(계획外)": sumBy(raw("사이트관리비")),
  };
  const expensePlan = {
    강사비: 27750000,
    인쇄비: 4000000,
    "다과 및 식비": 6600000,
    사무용품: 300000,
    "해외전시회 참가": 21585000,
    졸업식: 4600000,
    "교육장임차 및 회원수첩": 912000,
    주차비: 3000000,
    예비비: 2000000,
    "원우회 온라인 수첩 사이트 유지비(계획外)": 0,
  };
  const expenseRows = Object.keys(expensePlan).map((k) => ({
    item: k,
    plan: expensePlan[k],
    actual: actualByItem[k],
    diff: diffCell(expensePlan[k], actualByItem[k]),
    rate: rateCell(expensePlan[k], actualByItem[k]),
  }));
  const expensePlanTotal = Object.values(expensePlan).reduce((s, v) => s + v, 0);
  const expenseActualTotal = Object.values(actualByItem).reduce((s, v) => s + v, 0);

  renderSimpleTable(
    "budget-expense-table",
    [
      { key: "item", label: "구분" },
      { key: "plan", label: "당초 계획", render: (v) => fmtMoney(v) },
      { key: "actual", label: "실제", render: (v) => fmtMoney(v) },
      { key: "diff", label: "차이(실제-계획)" },
      { key: "rate", label: "집행률" },
    ],
    expenseRows,
    {
      item: "합계",
      plan: expensePlanTotal,
      actual: expenseActualTotal,
      diff: diffCell(expensePlanTotal, expenseActualTotal),
      rate: rateCell(expensePlanTotal, expenseActualTotal),
    },
  );

  byId("budget-note").innerHTML = [
    "해외전시회 참가는 계획 12명(선정) 대비 실제 참가 8명으로 축소되어 계획보다 낮게 집행됨",
    "교육장임차 및 회원수첩(계획)의 회원수첩 비용은 실제 집행 시 인쇄비 항목으로 편성되어 근사 비교임",
    "예비비(계획)는 실제 결산상 '운영비(행사 운영비)' 집행분에 대응",
    "졸업식(계획)은 기념품 등 수료식 고유 소모품만 비교한 값입니다. 11주차(수료식) 실제 총지출은 별도로 발생한 강사비·다과비·인쇄비·임차료·주차비를 포함해 8,582,600원이며, 이 비용들은 각각 강사비·다과및식비·인쇄비·교육장임차·주차비 항목에 이미 포함되어 있어 중복 계산을 피하기 위해 이렇게 나눔",
  ]
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");

  byId("budget-kpi").innerHTML = [
    ["당초 계획 예산", fmtMoney(expensePlanTotal), ""],
    ["실제 지출", fmtMoney(expenseActualTotal), "positive"],
    ["차액(절감)", fmtMoney(expensePlanTotal - expenseActualTotal), "positive"],
    ["집행률", fmtPercent(expenseActualTotal / expensePlanTotal), ""],
  ]
    .map(
      ([label, value, cls]) => `
        <article class="kpi-card">
          <p class="kpi-label">${label}</p>
          <p class="kpi-value ${cls}">${value}</p>
        </article>`,
    )
    .join("");
}

// 결과보고서 「차수별 출석률 및 만족도」 표
function renderWeeklyReport(data) {
  const survey = data.survey || {};
  const satByWeek = new Map();
  (survey.weekly || []).forEach((w) => {
    const m = w.label.match(/^(\d+)주/);
    if (m) satByWeek.set(Number(m[1]), w.avg);
  });

  const rows = (data.attendance.weekly || []).map((w) => {
    const total = w.attend + w.absent;
    return {
      week_label: w.week_label,
      lecturer: WEEK_LECTURERS[w.week] || "-",
      rate: w.trip ? "해외연수" : fmtPercent(w.rate),
      attend: w.trip ? `${w.attend}명 참가` : `${w.attend}/${total}명`,
      sat: satByWeek.has(w.week) ? satByWeek.get(w.week).toFixed(1) : "-",
    };
  });

  renderSimpleTable(
    "report-weekly-table",
    [
      { key: "week_label", label: "구분" },
      { key: "lecturer", label: "강사" },
      { key: "attend", label: "출석" },
      { key: "rate", label: "출석률" },
      { key: "sat", label: "만족도" },
    ],
    rows,
    {
      week_label: "평균",
      rate: fmtPercent(
        (data.attendance.weekly || []).reduce((s, w) => s + w.rate, 0) / ((data.attendance.weekly || []).length || 1),
      ),
      sat: survey.overall_avg ? Number(survey.overall_avg).toFixed(1) : "-",
    },
  );

  // 이전 기수 비교 (3기 이하 수치는 결과보고서 기재값)
  const lecturerAvg =
    (survey.lecturer || []).reduce((s, l) => s + l.avg, 0) / ((survey.lecturer || []).length || 1);
  const attendAvg =
    (data.attendance.weekly || []).reduce((s, w) => s + w.rate, 0) / ((data.attendance.weekly || []).length || 1);

  renderSimpleTable(
    "report-cohort-table",
    [
      { key: "cohort", label: "구분" },
      { key: "lecture", label: "강의 만족도" },
      { key: "action", label: "액션러닝 만족도" },
      { key: "attend", label: "출석률" },
    ],
    [
      {
        cohort: "4기",
        lecture: lecturerAvg.toFixed(1),
        action: survey.action_avg ? Number(survey.action_avg).toFixed(1) : "-",
        attend: fmtPercent(attendAvg),
      },
      { cohort: "3기", lecture: "4.6", action: "4.5", attend: "73.0%" },
      { cohort: "2기", lecture: "4.7", action: "4.5", attend: "76.0%" },
      { cohort: "1기", lecture: "4.7", action: "4.8", attend: "73.0%" },
      {
        cohort: "3기 대비",
        lecture: `${lecturerAvg - 4.6 >= 0 ? "▲" : "▼"}${Math.abs(lecturerAvg - 4.6).toFixed(1)}`,
        action: `${survey.action_avg - 4.5 >= 0 ? "▲" : "▼"}${Math.abs(survey.action_avg - 4.5).toFixed(1)}`,
        attend: `${attendAvg - 0.73 >= 0 ? "▲" : "▼"}${Math.abs((attendAvg - 0.73) * 100).toFixed(1)}%p`,
      },
    ],
  );
}

// 참여 명단 및 구성 (회원사/비회원사/이노비즈 인증)
function renderRoster(roster) {
  if (!roster || !roster.list || !roster.list.length) return;
  const s = roster.summary || {};

  byId("roster-note").textContent =
    `총 ${s.total}명 · 평균연령 만 ${s.avgAge}세(한국식 ${s.avgAgeKr}세, 생년 확인 ${s.ageSample}명 기준)`;

  byId("roster-kpi").innerHTML = [
    ["총 참여인원", `${s.total}명`, ""],
    ["회원사", `${s.member}명`, "positive"],
    ["비회원사", `${s.nonMember}명`, ""],
    ["이노비즈 인증사", `${s.certified}명`, "positive"],
    ["평균연령", `만 ${s.avgAge}세`, ""],
  ]
    .map(
      ([label, value, cls]) => `
        <article class="kpi-card">
          <p class="kpi-label">${label}</p>
          <p class="kpi-value ${cls}">${value}</p>
        </article>`,
    )
    .join("");

  const mark = (ok) => (ok ? `<span class="chip chip-on">O</span>` : `<span class="chip">-</span>`);
  renderSimpleTable(
    "roster-table",
    [
      { key: "idx", label: "번호" },
      { key: "name", label: "성명" },
      { key: "title", label: "직위" },
      { key: "company", label: "업체명", render: (v) => clipText(v, 20) },
      { key: "birthYear", label: "생년", render: (v) => (v ? `${v}년` : "-") },
      { key: "age", label: "나이", render: (v) => (v ? `만 ${v}세` : "-") },
      { key: "member", label: "회원사", render: (v) => mark(v) },
      { key: "certified", label: "이노비즈 인증", render: (v) => mark(v) },
      { key: "staffRole", label: "운영진", render: (v) => (v ? `<strong>${escapeHtml(v)}</strong>` : "-") },
    ],
    roster.list.map((m, i) => ({ ...m, idx: i + 1 })),
  );

  const btn = byId("roster-download");
  if (btn) {
    btn.addEventListener("click", () => {
      if (typeof XLSX === "undefined") return;
      const rows = roster.list.map((m, i) => ({
        번호: i + 1,
        성명: m.name,
        직위: m.title,
        업체명: m.company,
        생년: m.birthYear ? `${m.birthYear}년` : "-",
        나이: m.age ? `만 ${m.age}세` : "-",
        회원사: m.member ? "O" : "",
        "이노비즈 인증": m.certified ? "O" : "",
        운영진: m.staffRole || "",
      }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [{ wch: 5 }, { wch: 8 }, { wch: 8 }, { wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 10 }];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "4기 참여명단");
      XLSX.writeFile(book, `차경4기_참여명단_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }
}

function renderStaff(staff) {
  if (!staff || !staff.length) return;
  const byName = new Map(staff.map((s) => [s.name, s]));

  document.querySelectorAll(".org-panel .org-card, .org-panel .org-mini-card").forEach((card) => {
    const nameEl = card.querySelector(".org-name, strong");
    if (!nameEl) return;
    const info = byName.get(nameEl.textContent.trim());
    if (!info) return;
    card.classList.add("org-clickable");
    card.title = `${info.name} 연락처 보기`;
    card.addEventListener("click", () => {
      openModal(
        `${info.role} ${info.name} · ${info.company}`,
        [
          { key: "label", label: "구분" },
          { key: "value", label: "내용" },
        ],
        [
          { label: "업체명", value: info.company },
          { label: "연락처", value: info.phone },
          { label: "이메일", value: info.email },
        ],
      );
    });
  });

  const btn = byId("staff-download");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (typeof XLSX === "undefined") return;
    const rows = staff.map((s, i) => ({
      번호: i + 1,
      직책: s.role,
      성명: s.name,
      업체명: s.company,
      연락처: s.phone,
      이메일: s.email,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [{ wch: 5 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 26 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "4기 운영진");
    XLSX.writeFile(book, `차경4기_운영진연락처_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}

function bindCaptureButtons() {
  document.querySelectorAll(".capture-btn").forEach((btn) => {
    btn.addEventListener("click", () => captureSection(btn));
  });
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
  bindCaptureButtons();
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
      renderStaff(data.staff);
      renderFinanceReport(data);
      renderBudgetCompare(data);
      renderWeeklyReport(data);
      renderRoster(data.roster);

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
