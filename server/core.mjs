// @ts-check
// 브라우저와 같은 규칙(섹션 키·피드백 정규화·프롬프트)을 서버·CLI 에서도 쓴다.
// dist/core.mjs 는 `npm run build` 가 만든다 (저장소에 함께 커밋되어 있어 빌드 없이 돈다).
import * as core from '../dist/core.mjs';
export { core };
