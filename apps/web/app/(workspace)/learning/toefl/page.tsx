'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ButtonLink, Card, PageHeader, StatusBadge } from '@/components/ui';
import { Icon, type IconName } from '@/components/icon';
import { useWorkspace } from '@/components/workspace-provider';

interface ModuleCard {
  title: string;
  description: string;
  icon: IconName;
  label: string;
  tone: 'brand' | 'info' | 'success' | 'warning';
  href: string;
  id: string;
}

const modules: ModuleCard[] = [
  {
    title: '阅读',
    description: '围绕学术文章，练习事实信息、词汇、推断与篇章结构。',
    icon: 'book',
    label: '学术阅读',
    tone: 'brand',
    href: '/learning/toefl/reading',
    id: 'reading',
  },
  {
    title: '听力',
    description: '通过对话与讲座音频，训练主旨、细节、态度和推断能力。',
    icon: 'headphones',
    label: '音频训练',
    tone: 'info',
    href: '/learning/toefl/listening',
    id: 'listening',
  },
  {
    title: '口语',
    description: '围绕独立表达与综合任务，训练组织、表达和限时作答。',
    icon: 'microphone',
    label: '表达训练',
    tone: 'warning',
    href: '/learning/toefl#speaking',
    id: 'speaking',
  },
  {
    title: '写作',
    description: '完成学术讨论与综合写作，接收教师评分和修改反馈。',
    icon: 'assign',
    label: '教师反馈',
    tone: 'success',
    href: '/learning/toefl#writing',
    id: 'writing',
  },
];

export default function ToeflLearningPage() {
  const pathname = usePathname();
  const { currentTenant } = useWorkspace();
  const studentToeflBase = pathname.startsWith('/student/')
    ? '/student/learning/toefl'
    : '/learning/toefl';
  const isStudent = currentTenant.roles.includes('student');
  const isTeacher = currentTenant.roles.includes('teacher');
  const canManageContent = currentTenant.roles.some((role) =>
    ['owner', 'admin', 'content_editor'].includes(role),
  );

  return (
    <>
      <PageHeader
        description="围绕托福阅读、听力、口语和写作组织课程、任务与学习路径。"
        eyebrow="学习板块"
        title="托福"
      />

      <section className="toefl-hero">
        <div className="toefl-hero-copy">
          <span className="toefl-mark">TOEFL</span>
          <p className="eyebrow eyebrow-light">General + TOEFL</p>
          <h2>把每一次托福训练，放进清晰的学习路径。</h2>
          <p>从学术阅读、音频听力到口语与写作，学生按任务完成训练，教师可以持续跟进结果。</p>
          <div className="toefl-hero-actions">
            {isStudent ? (
              <>
                <ButtonLink href="/student/tasks" icon="arrow">
                  开始学习
                </ButtonLink>
                <ButtonLink href="/student/paths" variant="secondary">
                  查看托福路径
                </ButtonLink>
              </>
            ) : null}
            {isTeacher ? (
              <>
                <ButtonLink href="/teacher/assignments/new" icon="assign">
                  布置托福任务
                </ButtonLink>
                <ButtonLink href="/teacher/students" variant="secondary">
                  查看学生
                </ButtonLink>
              </>
            ) : null}
            {canManageContent ? (
              <ButtonLink href="/admin/content" icon="library" variant="secondary">
                管理托福内容
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <div className="toefl-score-card" aria-label="托福学习范围">
          <span>学习范围</span>
          <strong>4</strong>
          <p>阅读 · 听力 · 口语 · 写作</p>
          <div className="toefl-score-line" />
          <small>课程、任务、反馈和进度统一管理</small>
        </div>
      </section>

      <section className="toefl-section" aria-labelledby="toefl-modules-title">
        <div className="card-header">
          <div>
            <h2 id="toefl-modules-title">托福学习模块</h2>
            <p>按能力拆分训练内容，后续可以继续扩展模考和个性化训练。</p>
          </div>
        </div>
        <div className="toefl-module-grid">
          {modules.map((module) => (
            <Link
              className="toefl-module-link"
              href={
                module.id === 'reading'
                  ? `${studentToeflBase}/reading`
                  : module.id === 'listening'
                    ? `${studentToeflBase}/listening`
                    : `${studentToeflBase}#${module.id}`
              }
              id={module.id}
              key={module.title}
            >
              <Card className="toefl-module-card">
                <span className={'toefl-module-icon tone-' + module.tone}>
                  <Icon name={module.icon} size={22} />
                </span>
                <StatusBadge tone={module.tone}>{module.label}</StatusBadge>
                <h3>{module.title}</h3>
                <p>{module.description}</p>
                <span className="toefl-module-arrow">
                  {module.id === 'reading'
                    ? '进入文章库'
                    : module.id === 'listening'
                      ? '进入音频库'
                      : '查看板块'}
                  <Icon name="arrow" size={15} />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="toefl-section" aria-labelledby="toefl-workflow-title">
        <div className="card-header">
          <div>
            <h2 id="toefl-workflow-title">学习流程</h2>
            <p>内容、任务、作答和反馈形成一条连续闭环。</p>
          </div>
        </div>
        <div className="toefl-workflow">
          {[
            ['01', '选择路径', '根据目标日期进入托福学习路径。'],
            ['02', '完成训练', '按计划完成听力、阅读和写作任务。'],
            ['03', '获得反馈', '查看自动评分或教师批改意见。'],
            ['04', '持续改进', '根据进度和反馈安排下一轮练习。'],
          ].map(([index, title, description]) => (
            <Card className="toefl-workflow-step" key={index}>
              <span>{index}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
