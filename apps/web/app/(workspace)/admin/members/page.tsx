import { MemberManager } from '@/components/member-manager';
import { PageHeader } from '@/components/ui';

export default function AdminMembersPage() {
  return (
    <>
      <PageHeader
        description="一个成员可以同时拥有多个租户内角色；停用只影响当前机构。"
        eyebrow="机构管理"
        title="成员与角色"
      />
      <MemberManager />
    </>
  );
}
