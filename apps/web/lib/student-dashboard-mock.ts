export type StudentSkill = 'reading' | 'listening' | 'speaking' | 'writing';

export interface StudentNavItem {
  label: string;
  href: string;
  icon: StudentSkill | 'overview' | 'path' | 'vocabulary';
}

export interface StudentSkillProgress {
  id: StudentSkill;
  label: string;
  level: string;
  progress: number;
  href: string;
}

export interface StudentPlanItem {
  id: string;
  skill: StudentSkill;
  title: string;
  description: string;
  detail: string;
  durationMinutes: number;
  href: string;
}

export interface WeeklyPeriod {
  id: 'this-week' | 'last-week' | 'last-30-days';
  label: string;
  streakDays: number;
  hours: number;
  values: number[];
}

export const studentDashboardMock = {
  learner: {
    firstName: 'Alex',
    memberSince: 'May 2024',
    membership: 'Premium Member',
  },
  navigation: [
    { label: 'Overview', href: '/student', icon: 'overview' },
    { label: 'My Path', href: '/student/paths', icon: 'path' },
    { label: 'Reading', href: '/learning/toefl', icon: 'reading' },
    { label: 'Listening', href: '/learning/toefl/listening', icon: 'listening' },
    { label: 'Speaking', href: '/learning/toefl', icon: 'speaking' },
    { label: 'Writing', href: '/learning/toefl', icon: 'writing' },
    { label: 'Vocabulary', href: '/learning/toefl/listening', icon: 'vocabulary' },
  ] satisfies StudentNavItem[],
  continueLearning: {
    eyebrow: 'Continue learning',
    title: 'The Architecture\nof Memory',
    skill: 'Reading',
    level: 'Advanced',
    progress: 68,
    href: '/student/tasks/task-reading-01',
  },
  skills: [
    {
      id: 'reading',
      label: 'Reading',
      level: 'Advanced',
      progress: 72,
      href: '/learning/toefl',
    },
    {
      id: 'listening',
      label: 'Listening',
      level: 'Upper Intermediate',
      progress: 65,
      href: '/learning/toefl/listening',
    },
    {
      id: 'speaking',
      label: 'Speaking',
      level: 'Upper Intermediate',
      progress: 58,
      href: '/learning/toefl',
    },
    {
      id: 'writing',
      label: 'Writing',
      level: 'Upper Intermediate',
      progress: 61,
      href: '/learning/toefl',
    },
  ] satisfies StudentSkillProgress[],
  todayPlan: [
    {
      id: 'academic-reading',
      skill: 'reading',
      title: 'Academic Reading',
      description: 'Scholarly articles',
      detail: 'Infer main ideas',
      durationMinutes: 25,
      href: '/student/tasks/task-reading-01',
    },
    {
      id: 'lecture-listening',
      skill: 'listening',
      title: 'Lecture Listening',
      description: 'Note-taking',
      detail: 'Key details',
      durationMinutes: 30,
      href: '/learning/toefl/listening',
    },
    {
      id: 'speaking-practice',
      skill: 'speaking',
      title: 'Speaking Practice',
      description: 'Express opinions',
      detail: 'Academic discussion',
      durationMinutes: 20,
      href: '/student/tasks',
    },
  ] satisfies StudentPlanItem[],
  weeklyPeriods: [
    {
      id: 'this-week',
      label: 'This Week',
      streakDays: 5,
      hours: 12.4,
      values: [1, 2, 3.5, 2.5, 3, 4, 0.8],
    },
    {
      id: 'last-week',
      label: 'Last Week',
      streakDays: 4,
      hours: 10.8,
      values: [0.7, 1.8, 2.4, 3.2, 2.6, 3.6, 1.4],
    },
    {
      id: 'last-30-days',
      label: 'Last 30 Days',
      streakDays: 12,
      hours: 46.2,
      values: [2.2, 3.5, 2.8, 4, 3.4, 3.8, 2.6],
    },
  ] satisfies WeeklyPeriod[],
  toeflTarget: {
    targetScore: 110,
    currentScore: 96,
    maximumScore: 120,
  },
  quote: {
    text: 'Precision in language leads to clarity in thought.',
    author: 'Nathaniel Hawthorne',
  },
} as const;
