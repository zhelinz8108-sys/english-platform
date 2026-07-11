import { ButtonLink, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="standalone-state" id="main-content">
      <EmptyState
        action={<ButtonLink href="/student">返回工作台</ButtonLink>}
        description="这个地址可能已失效，或你没有访问该资源的权限。"
        icon="path"
        title="没有找到页面"
      />
    </main>
  );
}
