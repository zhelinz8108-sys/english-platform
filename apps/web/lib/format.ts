import type { TenantRole, WorkflowState } from '@english/shared';
import type { TaskKind } from './types';

export const workflowLabels: Record<WorkflowState, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  submitted: '已提交',
  grading: '批改中',
  returned: '已退回',
  completed: '已完成',
  cancelled: '已取消',
};

export const taskKindLabels: Record<TaskKind, string> = {
  lesson: '课程',
  practice: '练习',
  assessment: '测评',
  writing: '写作',
};

export const roleLabels: Record<TenantRole, string> = {
  owner: '机构所有者',
  admin: '机构管理员',
  teacher: '教师',
  student: '学生',
  content_editor: '内容编辑',
  analyst: '数据分析',
};

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '未设置';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '未设置';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function workflowTone(
  state: WorkflowState,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (state === 'completed') {
    return 'success';
  }
  if (state === 'returned') {
    return 'warning';
  }
  if (state === 'cancelled') {
    return 'neutral';
  }
  if (state === 'submitted' || state === 'grading') {
    return 'info';
  }
  return 'neutral';
}

export function getInitials(name: string): string {
  return Array.from(name.trim()).slice(-2).join('').toUpperCase();
}

export function relativeDue(value: string | null): string {
  if (!value) {
    return '无截止时间';
  }
  const diffHours = Math.round((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (diffHours < 0) {
    return '已截止';
  }
  if (diffHours < 24) {
    return diffHours + ' 小时后截止';
  }
  const days = Math.ceil(diffHours / 24);
  return days + ' 天后截止';
}
