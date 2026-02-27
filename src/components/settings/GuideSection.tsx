import { HelpCircle } from 'lucide-react';
import { SettingsSection } from './SettingsSection';

export function GuideSection() {
  return (
    <SettingsSection
      icon={<HelpCircle size={18} className="text-accent" />}
      title="사용 안내"
    >
      <ol className="text-xs text-text-secondary space-y-2 list-decimal list-inside">
        <li>대상 Google 스프레드시트를 엽니다.</li>
        <li>메뉴 → <strong>확장 프로그램</strong> → <strong>Apps Script</strong>를 클릭합니다.</li>
        <li>프로젝트 관리자가 제공한 스크립트 코드를 붙여넣고 저장합니다.</li>
        <li><strong>배포</strong> → <strong>새 배포</strong> → 유형: <strong>웹 앱</strong>을 선택합니다.</li>
        <li>실행 주체: <strong>본인</strong>, 액세스 권한: <strong>모든 사용자</strong>로 설정합니다.</li>
        <li>배포 후 나오는 URL을 복사해서 위에 입력하고 연결 테스트를 클릭합니다.</li>
        <li>연결 성공 후 설정을 저장하면 다음 실행부터 자동으로 연결됩니다.</li>
      </ol>
      <div className="mt-3 p-3 bg-bg-primary rounded-lg">
        <p className="text-[11px] text-text-secondary/60">
          시트 탭 이름은 <code className="text-accent">EP01_A</code>, <code className="text-accent">EP01_B</code>, <code className="text-accent">EP02_A</code> 형식이어야 합니다.
          <br />
          열 구조: A(No) B(씬번호) C(메모) D(스토리보드URL) E(가이드URL) F(담당자) G(LO) H(완료) I(검수) J(PNG)
        </p>
      </div>
    </SettingsSection>
  );
}
