# 디지털 공유 칠판 (Digital Shared Whiteboard)

외부 강의 시 수강생들과 실시간으로 자료를 공유하고 소통할 수 있는 웹 기반 협업 칠판입니다.

## 🎯 프로젝트 개요

- **이름**: 디지털 공유 칠판
- **목적**: 강의자와 수강생 간의 실시간 자료 공유 및 소통
- **주요 기능**: 
  - 방(Room) 생성 및 링크 공유
  - 칠판에 텍스트, URL 게시
  - 실시간 채팅
  - 모바일/데스크톱 완벽 대응

## 🌐 URL

- **테스트 URL**: https://3000-i0o6oylhh4k1lzu4276bc-3844e1b6.sandbox.novita.ai
- **GitHub**: (배포 후 추가 예정)
- **Production**: (배포 후 추가 예정)

## 💾 데이터 아키텍처

### 데이터 모델
- **rooms**: 방 정보 (ID, 이름, 생성자, 생성일시, 마지막 활동)
- **board_items**: 칠판 항목 (ID, 방ID, 타입, 내용, 작성자, 작성일시)
- **chat_messages**: 채팅 메시지 (ID, 방ID, 작성자, 메시지, 작성일시)

### 저장소 서비스
- **Cloudflare D1**: SQLite 기반 관계형 데이터베이스
- **로컬 개발**: `.wrangler/state/v3/d1` 로컬 SQLite
- **프로덕션**: Cloudflare D1 (글로벌 분산 데이터베이스)

## 📱 사용 가이드

### 강의자 (방 생성자)
1. 메인 페이지에서 "새 칠판 만들기" 클릭
2. 자동 생성된 6자리 방 코드 확인
3. "링크 복사" 버튼으로 URL 복사
4. 카카오톡 등으로 수강생들에게 링크 공유
5. 칠판에 텍스트나 URL 추가
6. 채팅으로 수강생들과 소통

### 수강생 (참여자)
1. 공유받은 링크 클릭 또는 방 코드 입력
2. 칠판에 공유된 자료 실시간 확인
3. 채팅으로 질문 작성

## ✨ 완료된 기능

- ✅ 방 생성 및 고유 코드 자동 생성
- ✅ 칠판에 텍스트 게시
- ✅ URL 자동 인식 및 링크 변환
- ✅ 실시간 채팅 (3초마다 폴링)
- ✅ 방 링크 복사 기능
- ✅ 모바일 반응형 UI (100vh/dvh 대응)
- ✅ D1 데이터베이스 연동

## 🚧 미구현 기능

- 이미지/파일 업로드
- 웹소켓 기반 실시간 동기화
- 방 삭제 기능
- 칠판 항목 삭제/수정
- 사용자 인증
- 방 비밀번호 보호

## 🔧 기술 스택

- **프레임워크**: Hono (경량 웹 프레임워크)
- **런타임**: Cloudflare Workers
- **데이터베이스**: Cloudflare D1 (SQLite)
- **프론트엔드**: Tailwind CSS, Font Awesome
- **빌드**: Vite
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
```

### 배포
```bash
# Cloudflare 인증 설정
# setup_cloudflare_api_key 도구 사용

# 프로덕션 D1 데이터베이스 생성
npx wrangler d1 create webapp-production

# wrangler.jsonc에 database_id 업데이트

# 프로덕션 데이터베이스 마이그레이션
npm run db:migrate:prod

# 프로젝트 배포
npm run deploy:prod
```

## 📊 다음 개발 단계

1. **WebSocket 지원**: Cloudflare Durable Objects로 실시간 동기화
2. **파일 업로드**: Cloudflare R2로 이미지/파일 저장
3. **그림 그리기**: Canvas API로 칠판에 그림 그리기
4. **사용자 관리**: 참여자 목록 및 권한 관리
5. **방 관리**: 방 삭제, 만료 시간 설정
6. **통계**: 참여자 수, 활동 로그

## 📄 라이선스

MIT License

## 👨‍💻 개발자

프로젝트 생성일: 2026-01-13
