import { ContentManager } from '@/components/content-manager';
import { PageHeader } from '@/components/ui';

export default function AdminContentPage() {
  return (
    <>
      <PageHeader
        description="平台官方目录只读；机构修改会复制为自己的稳定实体和草稿版本。"
        eyebrow="机构管理"
        title="内容与版本"
      />
      <ContentManager />
    </>
  );
}
