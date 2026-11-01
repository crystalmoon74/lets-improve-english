# Let's improve English skill

영어 회화 실력을 키우고 싶은 사람을 위한 웹앱. [Engoo Daily News](https://engoo.com/app/daily-news) 기사로 매일 읽기·단어·토론을 연습합니다. PC와 모바일(iOS Safari, Android Chrome) 모두 지원합니다.

## 기능

| 기능 | 설명 |
| --- | --- |
| 레벨 선택 | Beginner / Intermediate / Advanced (상단 배지로 언제든 변경) |
| 오늘의 추천 기사 | 선택한 레벨의 최신 Engoo Daily News 기사를 매일 추천 |
| 기사 듣기 | 기사 상단의 듣기 버튼으로 Engoo 원어민 낭독 전체 재생 (구간 이동, 0.75x/1x/1.25x 속도) |
| Reading | 기사를 읽으며 녹음 → 녹음이 저장되면 Reading **완료**. 문장을 누르면 원어민 음성 재생 |
| Vocabulary | 기사의 단어·뜻·한국어 뜻·예문 표시, 아는 단어 / 모르는 단어 체크 |
| 단어장 | 모르는 단어 → 1차 학습(체크박스 5개) → **1차 공부 완료** → 1주 뒤 2차 → 1주 뒤 3차 → 완료 |
| Discussion | Discussion + Further Discussion에서 질문 3개를 골라 각 답변을 녹음·저장 |

### 레벨 매핑

Engoo 기사 레벨(1–10)을 앱 레벨로 묶었습니다. Daily News에는 1–3 레벨 기사가 거의 없어서 Beginner는 가장 쉬운 4–5 레벨을 씁니다.

- Beginner: 4–5
- Intermediate: 6
- Advanced: 7–9

### 데이터 저장

로그인이나 서버 없이 브라우저에 저장됩니다.
- 진행 상황(레벨, 완료 상태, 단어장): `localStorage`
- 녹음 파일: `IndexedDB` (각 녹음의 "저장" 링크로 파일 다운로드 가능)

브라우저/기기마다 따로 저장되며, 브라우저 데이터를 지우면 함께 삭제됩니다.

## 구조

```
index.html, css/, js/          정적 웹앱 (빌드 없음)
data/articles.json             Engoo에서 가져온 기사 데이터
scripts/fetch-articles.mjs     Engoo API → data/articles.json
scripts/serve.mjs              로컬 테스트용 정적 서버
.github/workflows/deploy.yml   매일 기사 갱신 + GitHub Pages 배포
```

Engoo API는 CORS를 허용하지 않아 브라우저에서 직접 호출할 수 없습니다. 그래서 `fetch-articles.mjs`가 기사를 미리 받아 JSON으로 저장하고, 앱은 그 파일을 읽습니다.

## 로컬 실행 (Node 18+)

```bash
npm run fetch   # 최신 기사 가져오기
npm start       # http://localhost:8080
```

> 녹음(마이크)은 HTTPS 또는 `localhost`에서만 동작합니다. 휴대폰에서 PC의 LAN IP(http)로 접속하면 녹음이 막히니, 모바일 녹음 테스트는 GitHub Pages(HTTPS)에서 하세요.

## GitHub Pages 배포

1. GitHub에 새 저장소를 만들고 이 폴더를 `main` 브랜치로 push
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정
3. **Actions** 탭에서 workflow가 끝나면 `https://<사용자명>.github.io/<저장소명>/` 에서 접속

workflow는 push할 때와 매일 18:30 UTC(한국 시간 03:30)에 실행되어 기사를 새로 받아 커밋하고 다시 배포합니다.

## 모바일 팁

- iOS Safari: 공유 → "홈 화면에 추가"로 앱처럼 사용
- Android Chrome: 메뉴 → "홈 화면에 추가"
- 처음 녹음할 때 마이크 권한을 허용해야 합니다.
