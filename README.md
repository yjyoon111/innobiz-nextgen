# 4기 지출 웹 대시보드 (Vercel)

`web-dashboard` 폴더는 Vercel에 바로 올릴 수 있는 정적 대시보드입니다.

## 1) 데이터 갱신

엑셀 파일(`차경 3기 정산서.xlsx`, `차경 4기 정산서.xlsx`, `예산계획 4.xlsx`)을 수정한 뒤 아래 중 하나를 실행하세요.

- 루트에서: `update_web_dashboard.bat`
- 또는 직접: `python web-dashboard/scripts/generate_dashboard_data.py`

실행 후 `web-dashboard/data/dashboard.json`이 최신값으로 갱신됩니다.

## 2) Vercel 배포

1. GitHub 저장소에 이 폴더를 커밋/푸시
2. Vercel에서 새 프로젝트 연결
3. Root Directory를 `web-dashboard`로 지정
4. Framework Preset은 `Other` 선택
5. Build Command 비우기(정적 사이트)
6. Deploy

## 3) 운영 방식

- 엑셀 업데이트 → `update_web_dashboard.bat` 실행 → Git 푸시
- 푸시되면 Vercel이 자동 재배포

