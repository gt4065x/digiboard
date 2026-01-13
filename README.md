# 디지털 공유 칠판 (Digital Shared Whiteboard)

외부 강의 시 수강생들과 실시간으로 자료를 공유하고 소통할 수 있는 웹 기반 협업 칠판입니다.

## 🎯 프로젝트 개요

- **이름**: 디지털 공유 칠판 (DigiBoard)
- **목적**: 강의자와 수강생 간의 실시간 자료 공유 및 소통
- **주요 기능**: 
  - 방(Room) 생성 및 링크 공유
  - 칠판에 텍스트, URL, 이미지 게시
  - Canvas 기반 그림 그리기
  - 실시간 채팅 (3초 폴링)
  - 방 비밀번호 보호
  - 방 삭제 기능
  - 모바일/데스크톱 완벽 대응

## 🌐 URL

- **개발 환경**: https://3000-i0o6oylhh4k1lzu4276bc-3844e1b6.sandbox.novita.ai
- **GitHub**: https://github.com/gt4065x/digiboard
- **Production**: (배포 후 추가 예정)

## 💾 데이터 아키텍처

### 데이터 모델
- **rooms**: 방 정보 (ID, 이름, 생성자, 생성일시, 마지막 활동)
- **board_items**: 칠판 항목 (ID, 방ID, 타입, 내용, 작성자, 이미지URL, 작성일시)
- **chat_messages**: 채팅 메시지 (ID, 방ID, 작성자, 메시지, 작성일시)
- **drawings**: 그림 데이터 (ID, 방ID, 그림데이터, 작성자, 작성일시)
- **room_settings**: 방 설정 (방ID, 비밀번호, 만료시간, 활성화상태)

### 저장소 서비스
- **Cloudflare D1**: SQLite 기반 관계형 데이터베이스 (방, 칠판, 채팅, 그림 데이터)
- **Cloudflare R2**: S3 호환 객체 저장소 (이미지 파일)
- **로컬 개발**: `.wrangler/state/v3/d1` 로컬 SQLite
- **프로덕션**: Cloudflare D1 (글로벌 분산 데이터베이스) + R2 (이미지 저장)

## 📱 사용 가이드

### 강의자 (방 생성자)

#### 1. 방 만들기
1. 메인 페이지에서 "새 칠판 만들기" 클릭
2. 방 이름 입력 (선택)
3. 비밀번호 설정 (선택) - 설정하면 입장 시 비밀번호 요구
4. 자동 생성된 6자리 방 코드 확인

#### 2. 링크 공유
1. 상단의 "링크 복사" 버튼 클릭
2. 카카오톡, 문자 등으로 수강생들에게 공유

#### 3. 자료 공유
- **텍스트 탭**: 강의 내용, 메모, URL 작성
- **이미지 탭**: 이미지 파일 업로드 (PNG, JPG 등)
- **그림 탭**: Canvas에 직접 그림 그리기
  - 색상 선택 (검정, 빨강, 파랑, 초록, 노랑)
  - 선 굵기 조절 (가는선, 보통, 굵은선)
  - 지우기 버튼으로 전체 초기화
  - 저장 버튼으로 칠판에 추가

#### 4. 소통
- 하단 채팅창에서 수강생들과 실시간 소통
- 칠판 항목 우측 X 버튼으로 삭제 가능

#### 5. 방 관리
- 우측 상단 "삭제" 버튼으로 방 삭제 가능
- 비밀번호 설정한 경우 삭제 시 비밀번호 입력 필요

### 수강생 (참여자)

1. 강의자가 공유한 링크 클릭 또는 메인 페이지에서 방 코드 입력
2. 비밀번호가 설정된 경우 비밀번호 입력
3. 칠판에 공유된 자료 실시간 확인
   - 텍스트/URL: 자동으로 링크 변환되어 클릭 가능
   - 이미지: 업로드된 이미지 확인
   - 그림: 강의자가 그린 그림 확인
4. 채팅으로 질문 작성
5. "링크 복사" 버튼으로 다른 수강생에게 공유 가능

## ✨ 완료된 기능

### 핵심 기능
- ✅ 방 생성 및 고유 코드 (6자리) 자동 생성
- ✅ 방 비밀번호 보호 (선택)
- ✅ 방 삭제 기능
- ✅ 링크 복사 및 공유

### 칠판 기능
- ✅ 텍스트 게시
- ✅ URL 자동 인식 및 링크 변환
- ✅ 이미지 업로드 (Cloudflare R2)
- ✅ Canvas 기반 그림 그리기
  - ✅ 5가지 색상 지원
  - ✅ 3단계 선 굵기
  - ✅ 그림 저장 및 불러오기
- ✅ 칠판 항목 삭제

### 소통 기능
- ✅ 실시간 채팅 (3초마다 폴링)
- ✅ 작성자 이름 표시
- ✅ 시간 표시

### UI/UX
- ✅ 모바일 반응형 UI (100vh/dvh 대응)
- ✅ 터치 친화적 인터페이스
- ✅ 탭 기반 기능 전환 (텍스트/이미지/그림)
- ✅ 스크롤 최적화

## 🚧 미구현 기능 (향후 추가 예정)

- WebSocket 기반 완전 실시간 동기화 (Durable Objects)
- 방 만료 시간 설정
- 참여자 목록 표시
- 칠판 항목 수정 기능
- 그림에 텍스트 추가
- PDF 파일 업로드 및 뷰어
- 화면 공유 기능
- 통계 및 분석 (접속자 수, 활동 로그)

## 🔧 기술 스택

- **프레임워크**: Hono 4.x (경량 웹 프레임워크)
- **런타임**: Cloudflare Workers
- **데이터베이스**: Cloudflare D1 (SQLite)
- **스토리지**: Cloudflare R2 (이미지)
- **프론트엔드**: 
  - Tailwind CSS (스타일링)
  - Font Awesome (아이콘)
  - Vanilla JavaScript (Canvas API)
  - Axios (HTTP 클라이언트)
- **빌드**: Vite 6.x
- **배포**: Cloudflare Pages

## 🚀 개발 환경 설정

### 로컬 개발

```bash
# 의존성 설치
npm install

# 데이터베이스 마이그레이션 (로컬)
npm run db:migrate:local

# 프로젝트 빌드
npm run build

# 개발 서버 시작 (PM2)
pm2 start ecosystem.config.cjs

# 서비스 확인
curl http://localhost:3000

# 로그 확인
pm2 logs webapp --nostream
```

### 배포

```bash
# 1. Cloudflare 인증 설정
# setup_cloudflare_api_key 도구 사용

# 2. 프로덕션 D1 데이터베이스 생성
npx wrangler d1 create webapp-production
# 출력된 database_id를 wrangler.jsonc에 업데이트

# 3. R2 버킷 생성 (이미지 저장용)
npx wrangler r2 bucket create webapp-uploads

# 4. 프로덕션 데이터베이스 마이그레이션
npm run db:migrate:prod

# 5. Cloudflare Pages 프로젝트 생성
npx wrangler pages project create webapp --production-branch main

# 6. 프로젝트 배포
npm run deploy:prod
```

## 📊 프로젝트 구조

```
webapp/
├── src/
│   └── index.tsx          # 메인 애플리케이션 (API + HTML)
├── migrations/
│   ├── 0001_initial_schema.sql
│   └── 0002_add_images_and_drawings.sql
├── dist/                  # 빌드 결과물
│   ├── _worker.js
│   └── _routes.json
├── .wrangler/             # 로컬 개발 파일
│   └── state/v3/d1/       # 로컬 SQLite
├── ecosystem.config.cjs   # PM2 설정
├── wrangler.jsonc         # Cloudflare 설정
├── vite.config.ts         # Vite 빌드 설정
├── package.json           # 의존성 및 스크립트
└── README.md
```

## 📈 다음 개발 단계

### Phase 1: 실시간 강화
- [ ] Durable Objects + WebSocket으로 완전 실시간 동기화
- [ ] 참여자 목록 실시간 표시
- [ ] 타이핑 인디케이터

### Phase 2: 고급 기능
- [ ] PDF 업로드 및 뷰어
- [ ] 화면 캡처 및 공유
- [ ] 칠판 항목 수정 기능
- [ ] 그림에 텍스트/도형 추가

### Phase 3: 관리 기능
- [ ] 방 만료 시간 자동 설정
- [ ] 방 목록 및 관리 대시보드
- [ ] 사용 통계 및 분석
- [ ] 방 내보내기 (PDF/이미지)

## 🎨 주요 기능 스크린샷

### 메인 페이지
- 간편한 방 생성
- 방 코드 입력으로 빠른 입장

### 칠판 화면
- 상단: 방 정보 및 관리 버튼
- 중간: 칠판 영역 (탭으로 텍스트/이미지/그림 전환)
- 하단: 채팅 영역

### 모바일 최적화
- 반응형 레이아웃
- 터치 제스처 지원
- 화면 비율 자동 조정

## 📄 라이선스

MIT License

## 👨‍💻 개발 정보

- **프로젝트 시작**: 2026-01-13
- **개발자**: gt4065x
- **GitHub**: https://github.com/gt4065x/digiboard
- **이슈 및 문의**: GitHub Issues

## 🙏 감사의 말

이 프로젝트는 외부 강의 시 수강생들과의 원활한 소통을 위해 만들어졌습니다. 
강의 현장에서 유용하게 사용되기를 바랍니다.
