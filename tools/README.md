# tools: 검사와 성능 시험 도구

게임에는 들어가지 않는 개발용 도구야. 서버에는 올라가지만 게임이 쓰지는 않아.

## check_sync.py: twee 와 index.html 이 같은지 확인
```
python3 tools/check_sync.py .
```
스크립트, 스타일시트, 패시지 370개가 두 파일에서 같은지, 스크립트 문법(`node --check`)이 맞는지 봐. 둘 중 하나만 고쳤을 때 바로 잡아내. 푸시 전에 돌려.

## perf/: 느린 폰 / 느린 인터넷 시험 (Playwright 필요)
```
export NODE_PATH=$(npm root -g)

# 1) 느린 회선 흉내 서버 (BW: 전체 대역폭 bytes/초, LAT: 요청마다 지연 ms, MAXAGE: Cache-Control)
ROOT=. PORT=8124 BW=60000 LAT=500 node tools/perf/slowserver.js &

# 2) 자동 플레이 봇: 첫 로딩 시간, 플레이 중 그림 기다린 횟수와 시간, 엔딩 그림 대기를 잼
#    cpu: 느린 폰 배율, rounds: 엔딩까지 몇 판, readMs: 탭 간격, visits: 방문 횟수 (2 이상이면 재방문), blockSW: 서비스 워커 막기, skip: '먼저 시작하기' 누르기
node tools/perf/bot.js http://localhost:8124/ '{"cpu":4,"rounds":6,"readMs":150,"visits":2}'
```
- 서버를 켠 채로 `curl 'localhost:8124/__bw?v=100000&lat=300'` 으로 속도를 바꾸고, `/__fail?p=0.3&mode=drop` (또는 `stall`)으로 불안정한 회선을, `/__stats` 로 요청 기록을 볼 수 있어. (`BW` 가 0 이면 끊기 시험은 안 걸려)
- `offline.js <주소>`: 한 번 받은 뒤 서버를 끄고 다시 열어서 인터넷 없이 되는지 봄. 서버는 `MAXAGE=0` 으로 켜야 브라우저 기본 캐시에 안 기댐.
- `reval.js <주소> <루트 폴더>`: 서버의 그림을 바꿔치기해서, 바뀐 것만 다시 받는지 봄 (서버의 루트는 복사본으로).
- `shot.js <주소> <저장 이름> '[7000, 26000]'`: 처음 접속하고 해당 ms 뒤의 화면을 찍음.
